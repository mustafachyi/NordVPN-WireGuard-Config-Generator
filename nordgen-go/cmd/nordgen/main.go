package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"nordgen/internal/client"
	"nordgen/internal/constants"
	"nordgen/internal/generator"
	"nordgen/internal/models"
	"nordgen/internal/ui"
	"nordgen/internal/wireguard"
)

const defaultDNS = "103.86.96.100"

type nordAPI interface {
	GetKey(context.Context, string) (string, error)
	GetGeo(context.Context) (models.Coordinates, error)
	GetServers(context.Context) ([]models.RawServer, error)
}

type stringSlice []string

func (values *stringSlice) String() string {
	return strings.Join(*values, " ")
}

func (values *stringSlice) Set(value string) error {
	*values = append(*values, value)
	return nil
}

type generateOptions struct {
	token    string
	prefs    models.UserPreferences
	provided map[string]bool
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	exitCode := run(ctx, os.Args[1:], os.Stdin, os.Stdout)
	stop()
	os.Exit(exitCode)
}

func run(ctx context.Context, args []string, input io.Reader, output io.Writer) int {
	consoleManager := ui.NewConsoleManager(input, output)
	if containsHelp(args) {
		if err := printHelp(output); err != nil {
			return 1
		}
		return 0
	}

	command, commandArgs, err := resolveCommand(args)
	if err != nil {
		consoleManager.Fail(err.Error())
		helpErr := printHelp(output)
		if consoleManager.Err() != nil || helpErr != nil {
			return 1
		}
		return 2
	}
	if command == "help" {
		if err := printHelp(output); err != nil {
			return 1
		}
		return 0
	}

	nordClient := client.NewNordClient()
	switch command {
	case "get-key":
		options, parseErr := parseGetKeyOptions(commandArgs)
		if parseErr != nil {
			consoleManager.Fail(parseErr.Error())
			if consoleManager.Err() != nil {
				return 1
			}
			return 2
		}
		return runGetKey(ctx, consoleManager, nordClient, options)
	case "generate":
		options, parseErr := parseGenerateOptions(commandArgs)
		if parseErr != nil {
			consoleManager.Fail(parseErr.Error())
			if consoleManager.Err() != nil {
				return 1
			}
			return 2
		}
		return runGenerate(ctx, consoleManager, nordClient, options)
	default:
		consoleManager.Fail("Unknown command: " + command)
		if consoleManager.Err() != nil {
			return 1
		}
		return 2
	}
}

func containsHelp(args []string) bool {
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			return true
		}
	}
	return false
}

func resolveCommand(args []string) (string, []string, error) {
	if len(args) == 0 {
		return "generate", nil, nil
	}
	switch args[0] {
	case "help":
		if len(args) != 1 {
			return "", nil, fmt.Errorf("help does not accept arguments")
		}
		return "help", nil, nil
	case "get-key", "generate":
		return args[0], args[1:], nil
	default:
		if strings.HasPrefix(args[0], "-") {
			return "generate", args, nil
		}
		return "", nil, fmt.Errorf("unknown command: %s", args[0])
	}
}

func parseGenerateOptions(args []string) (generateOptions, error) {
	flagSet := flag.NewFlagSet("generate", flag.ContinueOnError)
	flagSet.SetOutput(io.Discard)

	var token string
	flagSet.StringVar(&token, "t", "", "NordVPN Access Token")
	flagSet.StringVar(&token, "token", "", "NordVPN Access Token")

	var dns string
	flagSet.StringVar(&dns, "d", defaultDNS, "DNS Server")
	flagSet.StringVar(&dns, "dns", defaultDNS, "DNS Server")

	var useIP bool
	flagSet.BoolVar(&useIP, "i", false, "Use IP Endpoint")
	flagSet.BoolVar(&useIP, "ip", false, "Use IP Endpoint")

	var keepalive int
	flagSet.IntVar(&keepalive, "k", 25, "Keepalive seconds")
	flagSet.IntVar(&keepalive, "keepalive", 25, "Keepalive seconds")

	var excludeDedicated bool
	flagSet.BoolVar(&excludeDedicated, "e", false, "Exclude dedicated IP servers")
	flagSet.BoolVar(&excludeDedicated, "exclude-dedicated", false, "Exclude dedicated IP servers")

	var groupValues stringSlice
	flagSet.Var(&groupValues, "g", "Server groups to include")
	flagSet.Var(&groupValues, "group", "Server groups to include")

	if err := flagSet.Parse(normalizeGroupArgs(args)); err != nil {
		return generateOptions{}, err
	}
	if flagSet.NArg() != 0 {
		return generateOptions{}, fmt.Errorf("unexpected argument: %s", flagSet.Arg(0))
	}

	provided := make(map[string]bool)
	flagSet.Visit(func(current *flag.Flag) {
		switch current.Name {
		case "t", "token":
			provided["token"] = true
		case "d", "dns":
			provided["dns"] = true
		case "i", "ip":
			provided["use_ip"] = true
		case "k", "keepalive":
			provided["keepalive"] = true
		case "e", "exclude-dedicated":
			provided["exclude_dedicated"] = true
		case "g", "group":
			provided["group"] = true
		}
	})

	groups, err := normalizeGroups(groupValues)
	if err != nil {
		return generateOptions{}, err
	}
	preferences := models.UserPreferences{
		DNS:              strings.TrimSpace(dns),
		UseIP:            useIP,
		Keepalive:        keepalive,
		Groups:           groups,
		ExcludeDedicated: excludeDedicated,
	}
	if err := validateGroupConflict(preferences); err != nil {
		return generateOptions{}, err
	}
	if len(provided) != 0 {
		if err := preferences.Validate(); err != nil {
			return generateOptions{}, err
		}
	}
	return generateOptions{token: token, prefs: preferences, provided: provided}, nil
}

func parseGetKeyOptions(args []string) (string, error) {
	flagSet := flag.NewFlagSet("get-key", flag.ContinueOnError)
	flagSet.SetOutput(io.Discard)
	var token string
	flagSet.StringVar(&token, "t", "", "NordVPN Access Token")
	flagSet.StringVar(&token, "token", "", "NordVPN Access Token")
	if err := flagSet.Parse(args); err != nil {
		return "", err
	}
	if flagSet.NArg() != 0 {
		return "", fmt.Errorf("unexpected argument: %s", flagSet.Arg(0))
	}
	return token, nil
}

func normalizeGroupArgs(args []string) []string {
	normalized := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg != "-g" && arg != "--group" {
			normalized = append(normalized, arg)
			continue
		}
		normalized = append(normalized, arg)
		if index+1 >= len(args) || strings.HasPrefix(args[index+1], "-") {
			continue
		}
		index++
		normalized = append(normalized, args[index])
		for index+1 < len(args) && !strings.HasPrefix(args[index+1], "-") {
			index++
			normalized = append(normalized, arg, args[index])
		}
	}
	return normalized
}

func normalizeGroups(values []string) ([]string, error) {
	groups := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		alias := strings.ToLower(strings.TrimSpace(value))
		groupID, exists := constants.GroupID(alias)
		if !exists {
			return nil, fmt.Errorf("unknown server group %q", value)
		}
		if _, duplicate := seen[groupID]; duplicate {
			continue
		}
		seen[groupID] = struct{}{}
		groups = append(groups, groupID)
	}
	return groups, nil
}

func validateGroupConflict(preferences models.UserPreferences) error {
	if !preferences.ExcludeDedicated {
		return nil
	}
	dedicated := constants.GroupDedicatedID
	for _, group := range preferences.Groups {
		if group == dedicated {
			return fmt.Errorf("cannot require the dedicated group while excluding dedicated servers")
		}
	}
	return nil
}

func validateToken(value string) (string, error) {
	token := strings.TrimSpace(value)
	if len(token) != 64 {
		return "", fmt.Errorf("token must contain exactly 64 hexadecimal characters")
	}
	if _, err := hex.DecodeString(token); err != nil {
		return "", fmt.Errorf("token must contain exactly 64 hexadecimal characters")
	}
	return token, nil
}

func resolvePrivateKey(ctx context.Context, consoleManager *ui.ConsoleManager, nordClient nordAPI, token string) (string, error) {
	if strings.TrimSpace(token) == "" {
		prompted, err := consoleManager.PromptSecret("NordVPN access token")
		if err != nil {
			return "", err
		}
		token = prompted
	}
	normalizedToken, err := validateToken(token)
	if err != nil {
		return "", err
	}

	consoleManager.StartStatus("Validating token...")
	if err := consoleManager.Err(); err != nil {
		consoleManager.StopStatus()
		return "", fmt.Errorf("write console output: %w", err)
	}
	key, err := nordClient.GetKey(ctx, normalizedToken)
	consoleManager.StopStatus()
	if outputErr := consoleManager.Err(); outputErr != nil {
		return "", fmt.Errorf("write console output: %w", outputErr)
	}
	if err != nil {
		if errors.Is(err, client.ErrUnauthorized) {
			return "", fmt.Errorf("token was rejected by NordVPN")
		}
		return "", fmt.Errorf("retrieve NordLynx private key: %w", err)
	}
	if err := wireguard.ValidateKey(key); err != nil {
		return "", fmt.Errorf("NordVPN returned an invalid private key: %w", err)
	}
	consoleManager.Success("Token validated")
	if err := consoleManager.Err(); err != nil {
		return "", fmt.Errorf("write console output: %w", err)
	}
	return key, nil
}

func runGetKey(ctx context.Context, consoleManager *ui.ConsoleManager, nordClient nordAPI, token string) int {
	interactive := strings.TrimSpace(token) == ""
	consoleManager.Header()
	if err := consoleManager.Err(); err != nil {
		return 1
	}
	key, err := resolvePrivateKey(ctx, consoleManager, nordClient, token)
	if err != nil {
		return handleRuntimeError(consoleManager, err, interactive)
	}
	consoleManager.ShowKey(key)
	if interactive {
		consoleManager.Wait()
	}
	return successfulExit(consoleManager)
}

func runGenerate(ctx context.Context, consoleManager *ui.ConsoleManager, nordClient nordAPI, options generateOptions) int {
	interactive := strings.TrimSpace(options.token) == ""
	promptPreferences := len(options.provided) == 0

	consoleManager.Header()
	if err := consoleManager.Err(); err != nil {
		return 1
	}
	key, err := resolvePrivateKey(ctx, consoleManager, nordClient, options.token)
	if err != nil {
		return handleRuntimeError(consoleManager, err, interactive)
	}

	preferences := options.prefs
	if promptPreferences {
		consoleManager.ClearScreen()
		preferences = consoleManager.PromptPreferences(preferences, options.provided)
		consoleManager.ClearScreen()
		if err := consoleManager.Err(); err != nil {
			return 1
		}
	}
	if err := preferences.Validate(); err != nil {
		return handleRuntimeError(consoleManager, err, interactive)
	}
	if err := validateGroupConflict(preferences); err != nil {
		return handleRuntimeError(consoleManager, err, interactive)
	}

	configurationGenerator := generator.NewGenerator(nordClient, consoleManager)
	startedAt := time.Now()
	outputPath, err := configurationGenerator.Process(ctx, key, preferences)
	if err != nil {
		return handleRuntimeError(consoleManager, err, interactive)
	}

	consoleManager.ClearScreen()
	consoleManager.Summary(outputPath, configurationGenerator.Stats, time.Since(startedAt).Seconds())
	if interactive {
		consoleManager.Wait()
	}
	return successfulExit(consoleManager)
}

func handleRuntimeError(consoleManager *ui.ConsoleManager, err error, wait bool) int {
	if errors.Is(err, ui.ErrCancelled) || errors.Is(err, context.Canceled) {
		consoleManager.Fail("Operation cancelled")
		return 130
	}
	consoleManager.Fail(err.Error())
	if wait {
		consoleManager.Wait()
	}
	return 1
}

func successfulExit(consoleManager *ui.ConsoleManager) int {
	if consoleManager.Err() != nil {
		return 1
	}
	return 0
}

func printHelp(output io.Writer) error {
	_, err := fmt.Fprint(output, `USAGE:
  nordgen [options]
  nordgen generate [options]
  nordgen get-key [options]

COMMANDS:
  generate    Generate WireGuard configurations (default)
  get-key     Extract the NordLynx private key from a token
  help        Show this help message

GENERATE OPTIONS:
  -t, --token              NordVPN access token (prompts if omitted)
  -d, --dns                DNS server IP (default: 103.86.96.100)
  -i, --ip                 Use IP addresses instead of hostnames for endpoints
  -k, --keepalive          PersistentKeepalive in seconds, 0-65535 (default: 25)
  -e, --exclude-dedicated  Exclude servers in the dedicated IP group
  -g, --group              Server groups to include; repeat or use a space-separated list
                           Valid groups: standard, p2p, dedicated, onion, double

GET-KEY OPTIONS:
  -t, --token              NordVPN access token

EXAMPLES:
  nordgen -t <your-token>
  nordgen -d 1.1.1.1 -k 15 -g standard p2p
  nordgen get-key -t <your-token>

`)
	return err
}
