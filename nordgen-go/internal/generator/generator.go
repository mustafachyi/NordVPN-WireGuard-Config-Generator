package generator

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"nordgen/internal/constants"
	"nordgen/internal/models"
	"nordgen/internal/ui"
	"nordgen/internal/wireguard"
)

const (
	fileNameMaxLength  = 15
	directoryMaxLength = 64
)

type serverClient interface {
	GetGeo(context.Context) (models.Coordinates, error)
	GetServers(context.Context) ([]models.RawServer, error)
}

type fileJob struct {
	path    string
	content []byte
}

type filePathAllocator struct {
	used       map[string]struct{}
	nextSuffix map[string]int
}

type Generator struct {
	client         serverClient
	consoleManager *ui.ConsoleManager
	Stats          models.GenerationStats
	workingDir     string
	now            func() time.Time
}

func NewGenerator(client serverClient, consoleManager *ui.ConsoleManager) *Generator {
	return &Generator{
		client:         client,
		consoleManager: consoleManager,
		workingDir:     ".",
		now:            time.Now,
	}
}

func sanitizePathSegment(segment string) string {
	return canonicalPathSegment(segment, 0)
}

func canonicalPathSegment(segment string, maximumBytes int) string {
	segment = strings.ToLower(strings.TrimSpace(segment))
	segment = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.C, r) || unicode.IsSpace(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, segment)

	if maximumBytes > 0 {
		segment = truncateUTF8(segment, maximumBytes)
	}
	segment = strings.TrimRight(segment, ". ")
	if segment == "" || segment == "." || segment == ".." {
		return "unknown"
	}

	if isWindowsReservedName(segment) {
		segment = "_" + segment
		if maximumBytes > 0 {
			segment = truncateUTF8(segment, maximumBytes)
		}
		segment = strings.TrimRight(segment, ". ")
		if segment == "" || segment == "." || segment == ".." {
			return "unknown"
		}
	}
	return segment
}

func isWindowsReservedName(segment string) bool {
	base := segment
	if index := strings.IndexByte(base, '.'); index >= 0 {
		base = base[:index]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$":
		return true
	}
	runes := []rune(base)
	if len(runes) != 4 {
		return false
	}
	prefix := strings.ToUpper(string(runes[:3]))
	if prefix != "COM" && prefix != "LPT" {
		return false
	}
	switch runes[3] {
	case '1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³':
		return true
	default:
		return false
	}
}

func truncateUTF8(value string, maximumBytes int) string {
	if maximumBytes <= 0 || len(value) <= maximumBytes {
		return value
	}
	for maximumBytes > 0 && !utf8.ValidString(value[:maximumBytes]) {
		maximumBytes--
	}
	if maximumBytes == 0 {
		return ""
	}
	return value[:maximumBytes]
}

func (g *Generator) Process(ctx context.Context, privateKey string, prefs models.UserPreferences) (string, error) {
	g.Stats = models.GenerationStats{}
	if err := prefs.Validate(); err != nil {
		return "", err
	}
	if err := validateGroups(prefs); err != nil {
		return "", err
	}
	if err := wireguard.ValidateKey(privateKey); err != nil {
		return "", fmt.Errorf("invalid private key: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	g.consoleManager.StartStatus("Fetching data...")
	if err := g.consoleError(); err != nil {
		g.consoleManager.StopStatus()
		return "", err
	}

	type geoResult struct {
		coordinates models.Coordinates
		err         error
	}
	type serverResult struct {
		servers []models.RawServer
		err     error
	}

	requestContext, cancelRequests := context.WithCancel(ctx)
	defer cancelRequests()

	geoChannel := make(chan geoResult, 1)
	serverChannel := make(chan serverResult, 1)
	go func() {
		coordinates, err := g.client.GetGeo(requestContext)
		geoChannel <- geoResult{coordinates: coordinates, err: err}
	}()
	go func() {
		servers, err := g.client.GetServers(requestContext)
		serverChannel <- serverResult{servers: servers, err: err}
	}()

	var geo geoResult
	var serverData serverResult
	geoReceived := false
	serversReceived := false
	for !geoReceived || !serversReceived {
		select {
		case geo = <-geoChannel:
			geoReceived = true
		case serverData = <-serverChannel:
			serversReceived = true
			if serverData.err != nil {
				cancelRequests()
				g.consoleManager.StopStatus()
				return "", g.withConsoleError(fmt.Errorf("fetch server data: %w", serverData.err))
			}
			if len(serverData.servers) == 0 {
				cancelRequests()
				g.consoleManager.StopStatus()
				return "", g.withConsoleError(fmt.Errorf("server data was empty"))
			}
		case <-ctx.Done():
			cancelRequests()
			g.consoleManager.StopStatus()
			return "", g.withConsoleError(ctx.Err())
		}
	}
	g.consoleManager.StopStatus()
	if err := g.consoleError(); err != nil {
		return "", err
	}
	g.consoleManager.Success("Fetched server data")
	if err := g.consoleError(); err != nil {
		return "", err
	}

	var observer *models.Coordinates
	if geo.err == nil && validCoordinates(geo.coordinates.Latitude, geo.coordinates.Longitude) {
		observer = &geo.coordinates
	} else {
		g.consoleManager.Info("Location unavailable; optimizing equal-load servers by name")
		if err := g.consoleError(); err != nil {
			return "", err
		}
	}

	g.consoleManager.StartStatus("Processing dataset...")
	if err := g.consoleError(); err != nil {
		g.consoleManager.StopStatus()
		return "", err
	}
	parsed := parseServers(serverData.servers, observer, prefs.Groups, prefs.ExcludeDedicated, prefs.UseIP)
	sort.Slice(parsed, func(i, j int) bool {
		return serverLess(parsed[i], parsed[j])
	})

	uniqueServers := make([]models.Server, 0, len(parsed))
	seenHostnames := make(map[string]struct{}, len(parsed))
	for _, server := range parsed {
		if _, exists := seenHostnames[server.Hostname]; exists {
			continue
		}
		seenHostnames[server.Hostname] = struct{}{}
		uniqueServers = append(uniqueServers, server)
	}
	if len(uniqueServers) == 0 {
		g.consoleManager.StopStatus()
		return "", g.withConsoleError(fmt.Errorf("no servers matched filters"))
	}

	bestServers := make([]models.Server, 0, len(uniqueServers))
	type bestKey struct {
		combo   string
		country string
		city    string
	}
	seenBest := make(map[bestKey]struct{}, len(uniqueServers))
	for _, server := range uniqueServers {
		key := bestKey{combo: server.Combo, country: server.Country, city: server.City}
		if _, exists := seenBest[key]; exists {
			continue
		}
		seenBest[key] = struct{}{}
		bestServers = append(bestServers, server)
	}

	g.Stats.Total = len(uniqueServers)
	g.Stats.Best = len(bestServers)

	now := g.now()
	outputName := fmt.Sprintf("nordvpn_configs_%s_%09d", now.Format("20060102_150405"), now.Nanosecond())
	temporaryRoot, err := os.MkdirTemp(g.workingDir, ".nordgen-")
	if err != nil {
		g.consoleManager.StopStatus()
		return "", g.withConsoleError(fmt.Errorf("create temporary output directory: %w", err))
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(temporaryRoot)
		}
	}()
	if err := secureOutputRoot(temporaryRoot); err != nil {
		g.consoleManager.StopStatus()
		return "", g.withConsoleError(fmt.Errorf("secure temporary output directory: %w", err))
	}

	jobs, err := g.buildJobs(temporaryRoot, uniqueServers, "configs", privateKey, prefs)
	if err == nil {
		var bestJobs []fileJob
		bestJobs, err = g.buildJobs(temporaryRoot, bestServers, "best_configs", privateKey, prefs)
		jobs = append(jobs, bestJobs...)
	}
	g.consoleManager.StopStatus()
	if err != nil {
		return "", g.withConsoleError(fmt.Errorf("build configuration files: %w", err))
	}
	if err := g.consoleError(); err != nil {
		return "", err
	}
	g.consoleManager.Success("Dataset processed")
	if err := g.consoleError(); err != nil {
		return "", err
	}

	if err := g.writeJobsParallel(ctx, jobs); err != nil {
		return "", fmt.Errorf("write configuration files: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	finalPath := filepath.Join(g.workingDir, outputName)
	if _, err := os.Lstat(finalPath); err == nil {
		return "", fmt.Errorf("commit output directory: destination already exists: %s", finalPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect output destination: %w", err)
	}
	if err := os.Rename(temporaryRoot, finalPath); err != nil {
		return "", fmt.Errorf("commit output directory: %w", err)
	}
	committed = true
	g.consoleManager.Success("Configuration files written")
	if err := g.consoleError(); err != nil {
		return "", err
	}
	return filepath.Clean(finalPath), nil
}

func validateGroups(prefs models.UserPreferences) error {
	dedicated := constants.GroupDedicatedID
	seen := make(map[string]struct{}, len(prefs.Groups))
	for _, group := range prefs.Groups {
		if !constants.IsTypeGroup(group) {
			return fmt.Errorf("unknown server group identifier %q", group)
		}
		if _, duplicate := seen[group]; duplicate {
			return fmt.Errorf("duplicate server group identifier %q", group)
		}
		seen[group] = struct{}{}
		if prefs.ExcludeDedicated && group == dedicated {
			return fmt.Errorf("cannot require the dedicated group while excluding dedicated servers")
		}
	}
	return nil
}

func serverLess(left, right models.Server) bool {
	if left.Load != right.Load {
		return left.Load < right.Load
	}
	if left.Distance != right.Distance {
		return left.Distance < right.Distance
	}
	if left.Hostname != right.Hostname {
		return left.Hostname < right.Hostname
	}
	if left.Combo != right.Combo {
		return left.Combo < right.Combo
	}
	if left.Country != right.Country {
		return left.Country < right.Country
	}
	if left.City != right.City {
		return left.City < right.City
	}
	if left.Station != right.Station {
		return left.Station < right.Station
	}
	return left.PublicKey < right.PublicKey
}

func newFilePathAllocator(capacity int) *filePathAllocator {
	return &filePathAllocator{
		used:       make(map[string]struct{}, capacity),
		nextSuffix: make(map[string]int, capacity),
	}
}

func (allocator *filePathAllocator) allocate(directory, nameRoot string) string {
	basePath := filepath.Join(directory, nameRoot)
	suffix := allocator.nextSuffix[basePath]
	for {
		fileName := nameRoot + ".conf"
		if suffix > 0 {
			fileName = nameRoot + "_" + strconv.Itoa(suffix) + ".conf"
		}
		candidate := filepath.Join(directory, fileName)
		suffix++
		if _, exists := allocator.used[candidate]; exists {
			continue
		}
		allocator.used[candidate] = struct{}{}
		allocator.nextSuffix[basePath] = suffix
		return candidate
	}
}

func (g *Generator) buildJobs(root string, servers []models.Server, subdirectory, privateKey string, prefs models.UserPreferences) ([]fileJob, error) {
	jobs := make([]fileJob, 0, len(servers))
	allocator := newFilePathAllocator(len(servers))

	for _, server := range servers {
		country := canonicalPathSegment(server.Country, directoryMaxLength)
		city := canonicalPathSegment(server.City, directoryMaxLength)
		combo := canonicalPathSegment(server.Combo, directoryMaxLength)
		nameRoot := canonicalPathSegment(server.Name, fileNameMaxLength)
		directory := filepath.Join(root, subdirectory, combo, country, city)
		path := allocator.allocate(directory, nameRoot)

		endpoint := server.Hostname
		if prefs.UseIP {
			endpoint = server.Station
		}
		content, err := wireguard.BuildConfig(privateKey, server.PublicKey, endpoint, prefs.DNS, prefs.Keepalive)
		if err != nil {
			return nil, fmt.Errorf("server %s: %w", server.Hostname, err)
		}
		jobs = append(jobs, fileJob{path: path, content: content})
	}
	return jobs, nil
}

func (g *Generator) writeJobsParallel(ctx context.Context, jobs []fileJob) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(jobs) == 0 {
		return g.consoleError()
	}

	g.consoleManager.StartStatus("Preparing file system...")
	if err := g.consoleError(); err != nil {
		g.consoleManager.StopStatus()
		return err
	}
	directories := make(map[string]struct{}, len(jobs))
	for _, job := range jobs {
		directories[filepath.Dir(job.path)] = struct{}{}
	}
	orderedDirectories := make([]string, 0, len(directories))
	for directory := range directories {
		orderedDirectories = append(orderedDirectories, directory)
	}
	sort.Strings(orderedDirectories)
	for _, directory := range orderedDirectories {
		if err := ctx.Err(); err != nil {
			g.consoleManager.StopStatus()
			return err
		}
		if err := os.MkdirAll(directory, 0700); err != nil {
			g.consoleManager.StopStatus()
			return err
		}
	}
	g.consoleManager.StopStatus()
	if err := g.consoleError(); err != nil {
		return err
	}
	g.consoleManager.Success("File system prepared")
	if err := g.consoleError(); err != nil {
		return err
	}

	const message = "Writing all configs"
	progressEnabled := g.consoleManager.StartProgress(len(jobs), message)
	if err := g.consoleError(); err != nil {
		return err
	}

	workerContext, cancel := context.WithCancel(ctx)
	defer cancel()
	jobChannel := make(chan fileJob)
	var completed atomic.Int64
	var firstError error
	var firstErrorOnce sync.Once
	var workers sync.WaitGroup

	workerCount := runtime.GOMAXPROCS(0) * 2
	if workerCount < 2 {
		workerCount = 2
	}
	if workerCount > 32 {
		workerCount = 32
	}
	if workerCount > len(jobs) {
		workerCount = len(jobs)
	}

	for index := 0; index < workerCount; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-workerContext.Done():
					return
				case job, open := <-jobChannel:
					if !open {
						return
					}
					if err := writeFileExclusive(job.path, job.content); err != nil {
						firstErrorOnce.Do(func() {
							firstError = err
							cancel()
						})
						return
					}
					completed.Add(1)
				}
			}
		}()
	}

	progressDone := make(chan struct{})
	if progressEnabled {
		go func() {
			defer close(progressDone)
			ticker := time.NewTicker(50 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					g.consoleManager.UpdateProgress(int(completed.Load()), len(jobs), message)
					if g.consoleManager.Err() != nil {
						cancel()
						return
					}
				case <-workerContext.Done():
					g.consoleManager.UpdateProgress(int(completed.Load()), len(jobs), message)
					return
				}
			}
		}()
	} else {
		close(progressDone)
	}

sendLoop:
	for _, job := range jobs {
		select {
		case <-workerContext.Done():
			break sendLoop
		case jobChannel <- job:
		}
	}
	close(jobChannel)
	workers.Wait()
	cancel()
	<-progressDone
	g.consoleManager.StopProgress()

	if firstError != nil {
		return firstError
	}
	if err := g.consoleError(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if completed.Load() != int64(len(jobs)) {
		return errors.New("configuration write stopped before completion")
	}
	return nil
}

func writeFileExclusive(path string, content []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(content)
	closeErr := file.Close()
	result := errors.Join(writeErr, closeErr)
	if result == nil {
		return nil
	}
	return errors.Join(result, os.Remove(path))
}

func (g *Generator) consoleError() error {
	if err := g.consoleManager.Err(); err != nil {
		return fmt.Errorf("write console output: %w", err)
	}
	return nil
}

func (g *Generator) withConsoleError(err error) error {
	return errors.Join(err, g.consoleError())
}
