# NordVPN WireGuard Configuration Generator

A command-line tool for generating optimized NordVPN WireGuard configurations.

## Project Philosophy: A Focus on Quality

This project has been fundamentally refocused. Previously, multiple versions existed across several programming languages. This approach divided development effort and resulted in inconsistent quality.

The new directive is singular: to provide one exceptionally engineered tool that is robust, maintainable, and correct.

To this end, all previous language implementations have been archived. Development is now concentrated on two platforms:

1.  **This Command-Line Tool:** A complete rewrite in Python, packaged for professional use.
2.  **A Web Interface:** For users who require a graphical frontend.

This consolidated effort ensures a higher standard of quality and a more reliable end-product.

## Core Capabilities

*   **Package Distribution:** The tool is a proper command-line application, installable via PyPI. This eliminates manual dependency management.
*   **Performance:** Asynchronous architecture processes the entire NordVPN server list in seconds.
*   **Optimization:** Intelligently sorts servers by current load and geographic proximity to the user, generating configurations for the most performant connections.
*   **Structured Output:** Automatically creates a clean directory structure containing standard configurations, a `best_configs` folder for optimal servers per location, and a `servers.json` file with detailed metadata for analysis.
*   **Interactive and Non-Interactive:** A guided rich-CLI for interactive use. The core logic is structured to be scriptable.

## Installation

Prerequisites: Python 3.9+

Install the package using `pip`:

```bash
pip install nord-config-generator
```

## Usage

### Generate Configurations (Default Action)

Execute the application without any arguments. This is the primary function.

```bash
nordgen
```

The application will prompt for the required access token and configuration preferences.

### Retrieve Private Key

To retrieve and display your NordLynx private key without generating configurations, use the `get-key` command:

```bash
nordgen get-key
```

## Web Version

A graphical alternative is available for direct use in a web browser.

*   **Current Version:** [https://nord-configs.selfhoster.nl/](https://nord-configs.selfhoster.nl/)
*   **Legacy Version:** [https://wg-nord.pages.dev/](https://wg-nord.pages.dev/)

## Support

Project visibility and continued development are supported by two actions:

1.  **Star the Repository:** Starring the project on GitHub increases its visibility.
2.  **NordVPN Referral:** Using the referral link for new subscriptions provides support at no additional cost. Link: [https://ref.nordvpn.com/MXIVDoJGpKT](https://ref.nordvpn.com/MXIVDoJGpKT)

## License

This project is distributed under the GNU General Public License v3.0. See the `LICENSE` file for full details.