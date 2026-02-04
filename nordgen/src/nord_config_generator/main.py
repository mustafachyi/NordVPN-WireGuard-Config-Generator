import sys
import asyncio
import argparse
import time

from .ui import ConsoleManager
from .client import NordClient
from .generator import Generator
from .models import UserPreferences

async def main():
    ui = ConsoleManager()
    async with NordClient() as client:
        if len(sys.argv) > 1 and sys.argv[1] == "get-key":
            await run_get_key(ui, client)
        else:
            await run_generate(ui, client)

async def run_get_key(ui: ConsoleManager, client: NordClient):
    parser = argparse.ArgumentParser(prog="nordgen get-key", description="Retrieve Private Key")
    parser.add_argument('-t', '--token', help='NordVPN Access Token')
    
    args = parser.parse_args(sys.argv[2:])

    ui.clear()
    ui.header()
    
    key = await resolve_key(ui, client, args.token)
    if key:
        ui.show_key(key)
    ui.wait()

async def run_generate(ui: ConsoleManager, client: NordClient):
    parser = argparse.ArgumentParser(prog="nordgen", description="NordVPN WireGuard Config Generator")
    parser.add_argument('-t', '--token', help='NordVPN Access Token')
    parser.add_argument('-d', '--dns', default='103.86.96.100', help='DNS Server')
    parser.add_argument('-i', '--ip', action='store_true', help='Use IP Endpoint')
    parser.add_argument('-k', '--keepalive', type=int, default=25, help='Persistent Keepalive')

    args = parser.parse_args(sys.argv[1:])

    ui.clear()
    ui.header()
    
    prefs = UserPreferences(args.dns, args.ip, args.keepalive)
    key = ""
    
    if not args.token:
        key = await resolve_key(ui, client, "")
        if not key:
            ui.wait()
            return
        
        ui.clear()
        ui.header()
        prefs = ui.prompt_prefs(prefs)
    else:
        key = await resolve_key(ui, client, args.token)
        if not key:
            ui.wait()
            return

    ui.clear()
    ui.header()
    
    gen = Generator(client, ui)
    start = time.time()
    out = await gen.process(key, prefs)
    
    if out:
        ui.clear()
        ui.header()
        ui.summary(out, gen.stats, time.time() - start)
    
    ui.wait()

async def resolve_key(ui: ConsoleManager, client: NordClient, token: str) -> str:
    if not token:
        token = ui.prompt_secret("Please enter your NordVPN access token: ")
    
    if len(token) != 64:
        ui.error("Invalid token format")
        return ""

    ui.spin("Validating token...")
    key = await client.get_key(token)
    if not key:
        ui.fail("Token invalid")
        return ""
    
    ui.success("Token validated")
    return key

def cli_entry_point():
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    cli_entry_point()