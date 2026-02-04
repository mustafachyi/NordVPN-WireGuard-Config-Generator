package tui

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/mustafachyi/nordvpn-wireguard-config-generator/internal/structs"
	"github.com/pterm/pterm"
	"golang.org/x/term"
)

type Console struct {
	multi *pterm.MultiPrinter
}

func New() *Console {
	return &Console{
		multi: &pterm.DefaultMultiPrinter,
	}
}

func (c *Console) Clear() {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "cls")
		cmd.Stdout = os.Stdout
		cmd.Run()
	} else {
		fmt.Print("\033[H\033[2J")
	}
}

func (c *Console) Header() {
	pterm.DefaultBox.
		WithRightPadding(2).
		WithLeftPadding(2).
		WithBoxStyle(pterm.NewStyle(pterm.FgCyan)).
		Println(pterm.NewStyle(pterm.FgMagenta, pterm.Bold).Sprint("NordVPN Configuration Generator"))
}

func (c *Console) Help(mode string) {
	c.Clear()
	c.Header()
	pterm.DefaultSection.Println("Usage Guide")

	var data [][]string
	if mode == "generate" {
		data = [][]string{
			{"Flag", "Alias", "Description", "Default"},
			{"--token", "-t", "NordVPN Access Token", ""},
			{"--dns", "-d", "Target DNS Server", "103.86.96.100"},
			{"--ip", "-i", "Use IP Endpoint", "false"},
			{"--keepalive", "-k", "Persistent Keepalive", "25"},
			{"--help", "-h", "Show this message", ""},
		}
		pterm.DefaultTable.WithHasHeader().WithBoxed().WithData(data).Render()
		pterm.Println()
		pterm.Info.Println("Commands: nordgen [flags] | nordgen get-key [flags]")
	} else {
		data = [][]string{
			{"Flag", "Alias", "Description", "Default"},
			{"--token", "-t", "NordVPN Access Token", ""},
			{"--help", "-h", "Show this message", ""},
		}
		pterm.DefaultTable.WithHasHeader().WithBoxed().WithData(data).Render()
		pterm.Println()
		pterm.Info.Println("Usage: nordgen get-key [flags]")
	}
	pterm.Println()
}

func (c *Console) PromptSecret(prompt string) string {
	fmt.Print(pterm.Cyan(prompt))
	b, _ := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	return string(b)
}

func (c *Console) PromptPrefs(def structs.Preferences) structs.Preferences {
	pterm.Info.Println("Configuration Options (Enter for default)")

	p := def

	if in, _ := pterm.DefaultInteractiveTextInput.
		WithDefaultText(fmt.Sprintf("DNS IP (default: %s)", def.DNS)).
		Show(); in != "" {
		p.DNS = in
	}

	if in, _ := pterm.DefaultInteractiveTextInput.
		WithDefaultText("Use IP for endpoints? (y/N)").
		Show(); in == "y" || in == "Y" {
		p.UseIP = true
	}

	if in, _ := pterm.DefaultInteractiveTextInput.
		WithDefaultText(fmt.Sprintf("PersistentKeepalive (default: %d)", def.Keepalive)).
		Show(); in != "" {
		var v int
		if _, err := fmt.Sscanf(in, "%d", &v); err == nil {
			p.Keepalive = v
		}
	}
	return p
}

func (c *Console) StartProgress() {
	c.multi.Start()
}

func (c *Console) StopProgress() {
	c.multi.Stop()
}

func (c *Console) ProgressBar(total int, title string) *pterm.ProgressbarPrinter {
	b, _ := pterm.DefaultProgressbar.WithTotal(total).WithTitle(title).WithWriter(c.multi.NewWriter()).Start()
	return b
}

func (c *Console) Err(msg string)     { pterm.Error.Println(msg) }
func (c *Console) Success(msg string) { pterm.Success.Println(msg) }
func (c *Console) Info(msg string)    { pterm.Info.Println(msg) }
func (c *Console) Fail(msg string)    { pterm.Error.Println(msg) }

func (c *Console) ShowKey(k string) {
	pterm.DefaultBox.WithTitle("NordLynx Private Key").WithBoxStyle(pterm.NewStyle(pterm.FgGreen)).Println(pterm.Green(k))
}

func (c *Console) Summary(dir string, s structs.Stats, sec float64) {
	d := [][]string{
		{"Output Directory:", dir},
		{"Standard Configs:", fmt.Sprintf("%d", s.Total)},
		{"Optimized Configs:", fmt.Sprintf("%d", s.Best)},
		{"Incompatible:", pterm.Yellow(s.Rejected)},
		{"Duration:", fmt.Sprintf("%.2fs", sec)},
	}
	t, _ := pterm.DefaultTable.WithData(d).WithBoxed().Srender()
	pterm.DefaultBox.WithTitle("Complete").WithBoxStyle(pterm.NewStyle(pterm.FgGreen)).Println(t)
}

func (c *Console) Spin(txt string) {
	s, _ := pterm.DefaultSpinner.Start(txt)
	s.Success(txt)
}

func (c *Console) Wait() {
	pterm.Println()
	pterm.Info.Print("Press Enter to exit...")
	var i string
	fmt.Scanln(&i)
}
