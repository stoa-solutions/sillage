#!/usr/bin/env python3
"""Exercise the real Mac agents model with delayed, synthetic HTTP responses."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
model = (root / 'apps/macos/Sources/SillageMac/DJAgentsModel.swift').read_text()
contracts = (root / 'apps/macos/Sources/SillageKit/DJAgent.swift').read_text().split('extension HTTPClient {')[0]
fixture = (root / 'scripts/fixtures/agent-isolation.swift').read_text()
with tempfile.TemporaryDirectory(prefix='sillage-agents-') as directory:
    source = Path(directory) / 'AgentIsolation.swift'
    binary = Path(directory) / 'agent-isolation'
    source.write_text(model.replace('import SillageKit', 'import Combine') + '\n' + contracts + '\n' + fixture)
    subprocess.run(['xcrun', 'swiftc', '-parse-as-library', str(source), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True, timeout=30)
