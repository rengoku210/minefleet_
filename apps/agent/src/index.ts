import { loadLocalConfig, getControllerUrl, getAgentVersion } from './config.js';
import { AgentWebSocket } from './connection/websocket.js';
import { ProtocolHandler } from './connection/protocol.js';
import { MiningManager } from './mining/manager.js';
import { ThermalProtection } from './safety/thermal.js';
import { WorkloadProtection } from './safety/workload.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info({ version: getAgentVersion() }, 'MineFleet Agent starting');

  const localConfig = loadLocalConfig();
  if (!localConfig) {
    logger.fatal('No local configuration found. Please run the installer first.');
    process.exit(1);
  }

  const controllerUrl = getControllerUrl();
  logger.info({ controllerUrl, machineUid: localConfig.machineUid }, 'Configuration loaded');

  // Initialize components
  const miningManager = new MiningManager();
  const thermalProtection = new ThermalProtection();
  const workloadProtection = new WorkloadProtection();
  const ws = new AgentWebSocket(controllerUrl);
  const protocol = new ProtocolHandler(ws, miningManager);

  // Apply last known safe config if available
  if (localConfig.lastConfig) {
    logger.info({ version: localConfig.lastConfigVersion }, 'Applying last known config');
    await miningManager.applyConfig(localConfig.lastConfig);
    thermalProtection.setConfig(localConfig.lastConfig);
    workloadProtection.setConfig(localConfig.lastConfig);
  }

  // Wire up thermal protection
  thermalProtection.setOnAction(async (action, temp) => {
    logger.info({ action, temp }, 'Thermal protection action');
    if (action === 'pause') {
      await miningManager.pause();
      ws.send({ type: 'agent:mining_event', timestamp: Date.now(), payload: { event: 'paused', reason: `thermal: ${temp}°C` } });
    } else if (action === 'reduce') {
      // Reduce to half the configured limit
      const config = localConfig.lastConfig;
      if (config) {
        await miningManager.applyConfig({ ...config, cpuLimitPercent: Math.floor(config.cpuLimitPercent / 2) });
      }
      ws.send({ type: 'agent:mining_event', timestamp: Date.now(), payload: { event: 'reduced', reason: `thermal: ${temp}°C` } });
    } else {
      // Resume normal operation
      if (localConfig.lastConfig) {
        await miningManager.applyConfig(localConfig.lastConfig);
      }
      await miningManager.resume();
    }
  });

  // Wire up workload protection
  workloadProtection.setOnAction(async (action, cpu) => {
    logger.info({ action, cpu }, 'Workload protection action');
    if (action === 'pause') {
      await miningManager.pause();
      ws.send({ type: 'agent:mining_event', timestamp: Date.now(), payload: { event: 'paused', reason: `workload: CPU ${cpu.toFixed(1)}%` } });
    } else if (action === 'reduce') {
      const config = localConfig.lastConfig;
      if (config) {
        await miningManager.applyConfig({ ...config, cpuLimitPercent: Math.floor(config.cpuLimitPercent / 2) });
      }
      ws.send({ type: 'agent:mining_event', timestamp: Date.now(), payload: { event: 'reduced', reason: `workload: CPU ${cpu.toFixed(1)}%` } });
    } else {
      if (localConfig.lastConfig) {
        await miningManager.applyConfig(localConfig.lastConfig);
      }
      await miningManager.resume();
    }
  });

  // Wire up WebSocket
  ws.setMessageHandler((msg) => protocol.handleMessage(msg));
  ws.setOnConnected(() => protocol.authenticate());
  ws.setOnDisconnected(() => {
    logger.warn('Disconnected from controller, continuing with last safe config');
  });

  // Start everything
  thermalProtection.start();
  workloadProtection.start();
  ws.connect();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Agent shutting down');
    thermalProtection.stop();
    workloadProtection.stop();
    ws.shutdown();
    await miningManager.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Agent failed to start');
  process.exit(1);
});
