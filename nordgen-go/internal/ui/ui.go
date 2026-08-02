package ui

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"nordgen/internal/models"

	"golang.org/x/term"
)

const (
	maskChar              = '*'
	maxTokenReadBytes     = 1024
	maxRawSecretReadBytes = maxTokenReadBytes * 4
	maxLineDiscardBytes   = 4096
)

var (
	ErrCancelled    = errors.New("operation cancelled")
	ErrInputTooLong = errors.New("input exceeded maximum length")
)

type ConsoleManager struct {
	reader         *bufio.Reader
	inputFile      *os.File
	output         io.Writer
	inputTerminal  bool
	outputTerminal bool
	outputMutex    sync.Mutex
	outputErr      error
	spinnerActive  atomic.Bool
	spinnerStop    chan struct{}
	spinnerExited  chan struct{}
	progressActive atomic.Bool
	progressMutex  sync.Mutex
	makeRaw        func(int) (*term.State, error)
	restore        func(int, *term.State) error
}

func NewConsoleManager(input io.Reader, output io.Writer) *ConsoleManager {
	manager := &ConsoleManager{
		reader:  bufio.NewReader(input),
		output:  output,
		makeRaw: term.MakeRaw,
		restore: term.Restore,
	}
	if inputFile, ok := input.(*os.File); ok {
		manager.inputFile = inputFile
		manager.inputTerminal = term.IsTerminal(int(inputFile.Fd()))
	}
	if outputFile, ok := output.(*os.File); ok {
		manager.outputTerminal = term.IsTerminal(int(outputFile.Fd()))
	}
	return manager
}

func (c *ConsoleManager) applyColor(code, text string) string {
	if !c.outputTerminal {
		return text
	}
	return fmt.Sprintf("\033[%sm%s\033[0m", code, text)
}

func (c *ConsoleManager) writef(format string, values ...any) bool {
	c.outputMutex.Lock()
	defer c.outputMutex.Unlock()
	if c.outputErr != nil {
		return false
	}
	_, err := fmt.Fprintf(c.output, format, values...)
	if err != nil {
		c.outputErr = err
		return false
	}
	return true
}

func (c *ConsoleManager) Err() error {
	c.outputMutex.Lock()
	defer c.outputMutex.Unlock()
	return c.outputErr
}

func (c *ConsoleManager) joinOutputError(err error) error {
	return errors.Join(err, c.Err())
}

func (c *ConsoleManager) ClearScreen() {
	if c.outputTerminal {
		c.writef("\033[2J\033[H")
	}
}

func (c *ConsoleManager) Header() {
	line := strings.Repeat("=", 50)
	c.writef("\n%s\n", c.applyColor("37", line))
	c.writef("%s\n", c.applyColor("1;97", "  NordVPN Configuration Generator"))
	c.writef("%s\n\n", c.applyColor("37", line))
}

func (c *ConsoleManager) PromptSecret(message string) (secret string, returnErr error) {
	if !c.writef("%s: ", c.applyColor("1;97", message)) {
		return "", c.Err()
	}
	if !c.inputTerminal || c.inputFile == nil {
		input, err := c.readLine(maxTokenReadBytes)
		c.writef("\n")
		if err != nil {
			return "", c.joinOutputError(err)
		}
		if err := c.Err(); err != nil {
			return "", err
		}
		return strings.TrimSpace(input), nil
	}

	oldState, err := c.makeRaw(int(c.inputFile.Fd()))
	if err != nil {
		c.writef("\r\n")
		return "", c.joinOutputError(fmt.Errorf("enable masked terminal input: %w", err))
	}
	defer func() {
		restoreErr := c.restore(int(c.inputFile.Fd()), oldState)
		returnErr = errors.Join(returnErr, restoreErr, c.Err())
	}()

	buffer := make([]byte, 0, 64)
	oneByte := make([]byte, 1)
	for totalRead := 0; totalRead < maxRawSecretReadBytes; totalRead++ {
		n, readErr := c.inputFile.Read(oneByte)
		if n == 0 {
			if readErr != nil {
				c.writef("\r\n")
				return "", c.joinOutputError(readErr)
			}
			c.writef("\r\n")
			return "", c.joinOutputError(io.ErrNoProgress)
		}

		value := oneByte[0]
		switch value {
		case '\r', '\n':
			if !c.writef("\r\n") {
				return "", c.Err()
			}
			return strings.TrimSpace(string(buffer)), nil
		case 3:
			c.writef("\r\n")
			return "", c.joinOutputError(ErrCancelled)
		case 127, 8:
			if len(buffer) > 0 {
				buffer = buffer[:len(buffer)-1]
				if !c.writef("\b \b") {
					return "", c.Err()
				}
			}
		default:
			if value < 32 {
				continue
			}
			if len(buffer) >= maxTokenReadBytes {
				c.writef("\r\n")
				return "", c.joinOutputError(ErrInputTooLong)
			}
			buffer = append(buffer, value)
			if !c.writef("%c", maskChar) {
				return "", c.Err()
			}
		}
	}
	c.writef("\r\n")
	return "", c.joinOutputError(ErrInputTooLong)
}

func (c *ConsoleManager) readLine(limit int) (string, error) {
	var builder strings.Builder
	builder.Grow(64)
	for {
		value, err := c.reader.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) && builder.Len() > 0 {
				return strings.TrimSuffix(builder.String(), "\r"), nil
			}
			return "", err
		}
		if value == '\n' {
			return strings.TrimSuffix(builder.String(), "\r"), nil
		}
		if builder.Len() >= limit {
			for discarded := 0; discarded < maxLineDiscardBytes; discarded++ {
				value, err = c.reader.ReadByte()
				if err != nil || value == '\n' {
					break
				}
			}
			return "", ErrInputTooLong
		}
		builder.WriteByte(value)
	}
}

func (c *ConsoleManager) PromptPreferences(defaults models.UserPreferences, provided map[string]bool) models.UserPreferences {
	promptedAny := false
	announce := func() {
		if !promptedAny {
			c.Info("Configuration Options (Enter for default)")
			promptedAny = true
		}
	}

	dns := defaults.DNS
	if !provided["dns"] {
		announce()
		dns = c.promptAddress("DNS IP", defaults.DNS)
	}

	useIP := defaults.UseIP
	if !provided["use_ip"] {
		announce()
		useIP = c.promptBool("Use IP for endpoints?", defaults.UseIP)
	}

	keepalive := defaults.Keepalive
	if !provided["keepalive"] {
		announce()
		keepalive = c.promptInt("PersistentKeepalive", defaults.Keepalive, 0, models.MaxKeepalive)
	}

	excludeDedicated := defaults.ExcludeDedicated
	if !provided["exclude_dedicated"] {
		announce()
		excludeDedicated = c.promptBool("Exclude dedicated IP servers?", defaults.ExcludeDedicated)
	}

	return models.UserPreferences{
		DNS:              strings.TrimSpace(dns),
		UseIP:            useIP,
		Keepalive:        keepalive,
		Groups:           defaults.Groups,
		ExcludeDedicated: excludeDedicated,
	}
}

func (c *ConsoleManager) promptString(message, defaultValue string) string {
	c.writef("%s [%s]: ", c.applyColor("1;97", message), c.applyColor("37", defaultValue))
	input, err := c.readLine(4096)
	if err != nil {
		return defaultValue
	}
	input = strings.TrimSpace(input)
	if input == "" {
		return defaultValue
	}
	return input
}

func (c *ConsoleManager) promptAddress(message, defaultValue string) string {
	for {
		value := c.promptString(message, defaultValue)
		address, err := netip.ParseAddr(strings.TrimSpace(value))
		if err == nil {
			return address.String()
		}
		c.Fail("Enter a valid IPv4 or IPv6 address")
		if c.Err() != nil {
			return defaultValue
		}
	}
}

func (c *ConsoleManager) promptBool(message string, defaultValue bool) bool {
	defaultString := "y/N"
	if defaultValue {
		defaultString = "Y/n"
	}
	for {
		c.writef("%s [%s]: ", c.applyColor("1;97", message), c.applyColor("37", defaultString))
		input, err := c.readLine(16)
		if err != nil {
			return defaultValue
		}
		switch strings.ToLower(strings.TrimSpace(input)) {
		case "":
			return defaultValue
		case "y", "yes":
			return true
		case "n", "no":
			return false
		default:
			c.Fail("Enter yes or no")
			if c.Err() != nil {
				return defaultValue
			}
		}
	}
}

func (c *ConsoleManager) promptInt(message string, defaultValue, minimum, maximum int) int {
	for {
		value := c.promptString(message, strconv.Itoa(defaultValue))
		parsed, err := strconv.Atoi(value)
		if err == nil && parsed >= minimum && parsed <= maximum {
			return parsed
		}
		c.Fail(fmt.Sprintf("Enter a value between %d and %d", minimum, maximum))
		if c.Err() != nil {
			return defaultValue
		}
	}
}

func (c *ConsoleManager) StartStatus(message string) {
	if !c.outputTerminal {
		c.writef("%s\n", message)
		return
	}
	if c.spinnerActive.Swap(true) {
		return
	}

	c.spinnerStop = make(chan struct{})
	c.spinnerExited = make(chan struct{})
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	if !c.writef("\r\033[K%s %s", c.applyColor("96", frames[0]), message) {
		c.spinnerActive.Store(false)
		c.spinnerStop = nil
		c.spinnerExited = nil
		return
	}

	go func() {
		defer close(c.spinnerExited)
		index := 1
		ticker := time.NewTicker(80 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-c.spinnerStop:
				c.writef("\r\033[K")
				return
			case <-ticker.C:
				if !c.writef("\r\033[K%s %s", c.applyColor("96", frames[index%len(frames)]), message) {
					return
				}
				index++
			}
		}
	}()
}

func (c *ConsoleManager) StopStatus() {
	if !c.outputTerminal || !c.spinnerActive.Swap(false) {
		return
	}
	if c.spinnerStop != nil {
		close(c.spinnerStop)
		if c.spinnerExited != nil {
			<-c.spinnerExited
		}
		c.spinnerStop = nil
		c.spinnerExited = nil
	}
}

func (c *ConsoleManager) StartProgress(total int, message string) bool {
	if !c.outputTerminal || total <= 0 || c.Err() != nil || c.progressActive.Swap(true) {
		return false
	}
	c.UpdateProgress(0, total, message)
	if c.Err() != nil {
		c.progressActive.Store(false)
		return false
	}
	return true
}

func (c *ConsoleManager) UpdateProgress(current, total int, message string) {
	if !c.outputTerminal || !c.progressActive.Load() || total <= 0 || c.Err() != nil {
		return
	}
	c.progressMutex.Lock()
	defer c.progressMutex.Unlock()
	if current < 0 {
		current = 0
	}
	if current > total {
		current = total
	}
	width := 30
	completed := width * current / total
	bar := c.applyColor("92", strings.Repeat("█", completed)) + c.applyColor("37", strings.Repeat("░", width-completed))
	c.writef("\r\033[K%s %s [%s] %d/%d", c.applyColor("96", "→"), message, bar, current, total)
}

func (c *ConsoleManager) StopProgress() {
	if c.outputTerminal && c.progressActive.Swap(false) {
		c.writef("\n")
	}
}

func (c *ConsoleManager) Success(message string) {
	c.writef("%s %s\n", c.applyColor("92", "✓"), message)
}

func (c *ConsoleManager) Fail(message string) {
	c.writef("%s %s\n", c.applyColor("91", "✗"), message)
}

func (c *ConsoleManager) Info(message string) {
	c.writef("%s %s\n", c.applyColor("96", "→"), message)
}

func (c *ConsoleManager) ShowKey(key string) {
	c.writef("\n%s\n", c.applyColor("1;97", "NordLynx Private Key"))
	c.writef("%s\n\n", c.applyColor("92", key))
}

func (c *ConsoleManager) Summary(outputPath string, stats models.GenerationStats, duration float64) {
	line := strings.Repeat("=", 45)
	c.writef("\n%s\n", c.applyColor("37", line))
	c.writef("%s\n", c.applyColor("1;97", "  Complete"))
	c.writef("%s\n", c.applyColor("37", line))
	c.writef("  Output Directory:    %s\n", c.applyColor("96", outputPath))
	c.writef("  Total Files Written: %s\n", c.applyColor("96", strconv.Itoa(stats.Total+stats.Best)))
	c.writef("   ├── Standard:       %s\n", c.applyColor("96", strconv.Itoa(stats.Total)))
	c.writef("   └── Optimized:      %s\n", c.applyColor("96", strconv.Itoa(stats.Best)))
	c.writef("  Duration:            %s\n", c.applyColor("96", fmt.Sprintf("%.2fs", duration)))
	c.writef("%s\n\n", c.applyColor("37", line))
}

func (c *ConsoleManager) Wait() {
	if !c.inputTerminal || c.Err() != nil {
		return
	}
	if !c.writef("%s", c.applyColor("37", "Press Enter to exit... ")) {
		return
	}
	_, _ = c.readLine(4096)
}
