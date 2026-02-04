package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/client"
	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/gen"
	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/structs"
	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/tui"
)

func main() {
	ui := tui.New()
	api := client.New()

	if len(os.Args) > 1 && os.Args[1] == "get-key" {
		runGetKey(ui, api)
		return
	}

	runGenerate(ui, api)
}

func runGetKey(ui *tui.Console, api *client.Nord) {
	fs := flag.NewFlagSet("get-key", flag.ExitOnError)
	var token string
	var help bool

	fs.StringVar(&token, "t", "", "NordVPN access token")
	fs.StringVar(&token, "token", "", "NordVPN access token")
	fs.BoolVar(&help, "h", false, "Show usage")
	fs.BoolVar(&help, "help", false, "Show usage")

	fs.Usage = func() { ui.Help("get-key") }

	args := []string{}
	if len(os.Args) > 2 {
		args = os.Args[2:]
	}
	fs.Parse(args)

	if help {
		ui.Help("get-key")
		return
	}

	ui.Clear()
	ui.Header()
	key := resolveKey(ui, api, token)
	if key != "" {
		ui.ShowKey(key)
	}
	ui.Wait()
}

func runGenerate(ui *tui.Console, api *client.Nord) {
	fs := flag.NewFlagSet("generate", flag.ExitOnError)
	var (
		token string
		dns   string
		ip    bool
		ka    int
		help  bool
	)

	fs.StringVar(&token, "t", "", "NordVPN access token")
	fs.StringVar(&token, "token", "", "NordVPN access token")
	fs.StringVar(&dns, "d", "103.86.96.100", "DNS server IP")
	fs.StringVar(&dns, "dns", "103.86.96.100", "DNS server IP")
	fs.BoolVar(&ip, "i", false, "Use IP endpoint")
	fs.BoolVar(&ip, "ip", false, "Use IP endpoint")
	fs.IntVar(&ka, "k", 25, "Persistent keepalive")
	fs.IntVar(&ka, "keepalive", 25, "Persistent keepalive")
	fs.BoolVar(&help, "h", false, "Show usage")
	fs.BoolVar(&help, "help", false, "Show usage")

	fs.Usage = func() { ui.Help("generate") }
	fs.Parse(os.Args[1:])

	if help {
		ui.Help("generate")
		return
	}

	loader := gen.NewLoader(api)

	var key string
	prefs := structs.Preferences{
		DNS:       dns,
		UseIP:     ip,
		Keepalive: ka,
	}

	ui.Clear()
	ui.Header()

	if token == "" {
		key = resolveKey(ui, api, "")
		if key == "" {
			ui.Wait()
			return
		}
		ui.Clear()
		ui.Header()
		prefs = ui.PromptPrefs(prefs)
	} else {
		key = resolveKey(ui, api, token)
		if key == "" {
			ui.Wait()
			return
		}
	}

	ui.Clear()
	ui.Header()

	start := time.Now()

	ui.Spin("Finalizing data processing...")
	inventory, err := loader.Await()
	if err != nil {
		ui.Fail("Data synchronization failed")
		ui.Err(fmt.Sprintf("Process failed: %v", err))
		ui.Wait()
		return
	}
	ui.Success("Dataset ready")

	writer := gen.NewWriter(key, prefs, ui)
	outDir, stats := writer.Commit(inventory)

	elapsed := time.Since(start).Seconds()

	ui.Clear()
	ui.Header()
	ui.Summary(outDir, stats, elapsed)
	ui.Wait()
}

func resolveKey(ui *tui.Console, api *client.Nord, token string) string {
	if token == "" {
		token = ui.PromptSecret("Please enter your NordVPN access token: ")
	}

	if len(token) != 64 {
		ui.Err("Invalid token format")
		return ""
	}

	ui.Spin("Validating token...")
	key, err := api.GetPrivateKey(token)
	if err != nil {
		ui.Fail("Token invalid")
		return ""
	}
	ui.Success("Token validated")
	return key
}
