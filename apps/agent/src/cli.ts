import { Command } from 'commander';
import { loadLocalConfig, getAgentVersion } from './config.js';
import { platform } from 'node:os';
import { execSync } from 'node:child_process';

const program = new Command();

program
  .name('minefleet-agent')
  .description('MineFleet Mining Agent CLI')
  .version(getAgentVersion());

program
  .command('status')
  .description('Show agent status')
  .action(() => {
    const config = loadLocalConfig();
    if (!config) {
      console.log('Agent is not configured. Run the installer first.');
      process.exit(1);
    }

    console.log('MineFleet Agent Status');
    console.log('======================');
    console.log(`Machine ID:     ${config.machineId}`);
    console.log(`Machine UID:    ${config.machineUid}`);
    console.log(`Controller:     ${config.controllerUrl}`);
    console.log(`Config Version: ${config.lastConfigVersion}`);

    if (config.lastConfig) {
      console.log(`Mining Enabled: ${config.lastConfig.miningEnabled}`);
      console.log(`CPU Limit:      ${config.lastConfig.cpuLimitPercent}%`);
      console.log(`GPU Enabled:    ${config.lastConfig.gpuEnabled}`);
      console.log(`Policy:         ${config.lastConfig.workloadPolicy}`);
    }

    // Check service status
    try {
      if (platform() === 'win32') {
        const output = execSync('sc query MineFleetAgent', { encoding: 'utf-8' });
        console.log(`\nService Status:  ${output.includes('RUNNING') ? 'Running' : 'Stopped'}`);
      } else {
        const output = execSync('systemctl is-active minefleet-agent', { encoding: 'utf-8' }).trim();
        console.log(`\nService Status:  ${output}`);
      }
    } catch {
      console.log('\nService Status:  Unknown');
    }
  });

program
  .command('stop')
  .description('Stop the agent service')
  .action(() => {
    try {
      if (platform() === 'win32') {
        execSync('net stop MineFleetAgent', { stdio: 'inherit' });
      } else {
        execSync('sudo systemctl stop minefleet-agent', { stdio: 'inherit' });
      }
      console.log('Agent stopped.');
    } catch (err) {
      console.error('Failed to stop agent. Try running with elevated privileges.');
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Show recent agent logs')
  .option('-n, --lines <number>', 'Number of lines', '50')
  .action((opts) => {
    try {
      if (platform() === 'win32') {
        console.log('Logs are stored in C:\\ProgramData\\MineFleet\\logs\\');
      } else {
        execSync(`journalctl -u minefleet-agent -n ${opts.lines} --no-pager`, { stdio: 'inherit' });
      }
    } catch (err) {
      console.error('Failed to read logs.');
    }
  });

program
  .command('uninstall')
  .description('Uninstall the agent')
  .action(() => {
    console.log('Stopping agent...');
    try {
      if (platform() === 'win32') {
        execSync('net stop MineFleetAgent', { stdio: 'pipe' }).toString();
        execSync('nssm remove MineFleetAgent confirm', { stdio: 'pipe' }).toString();
        console.log('Service removed.');
      } else {
        execSync('sudo systemctl stop minefleet-agent', { stdio: 'pipe' });
        execSync('sudo systemctl disable minefleet-agent', { stdio: 'pipe' });
        execSync('sudo rm /etc/systemd/system/minefleet-agent.service', { stdio: 'pipe' });
        execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
        console.log('Service removed.');
      }
    } catch {
      console.log('Service may not have been installed.');
    }
    console.log('Agent uninstalled. Configuration files remain for manual cleanup.');
  });

program.parse();
