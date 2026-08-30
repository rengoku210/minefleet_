async function run() {
  console.log('1. Logging in to production...');
  const loginRes = await fetch('https://minefleet.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@minefleet.local', password: 'Admin1234!' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken;

  console.log('2. Creating enrollment token...');
  const enrollTokenRes = await fetch('https://minefleet.vercel.app/api/enrollment-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ label: 'Windows Production Machine' }),
  });
  const enrollTokenData = await enrollTokenRes.json();
  const rawEnrollToken = enrollTokenData.data.token;
  console.log('Enrollment Token:', rawEnrollToken);
  console.log('Windows Command:\n' + enrollTokenData.data.installCommandWindows);

  console.log('\n3. Testing Machine Enrollment (First time)...');
  const machineUid = 'mf_win_test_' + Date.now().toString(16);
  const sysInfo = {
    hostname: 'USER-WIN-PC',
    os: 'windows',
    osVersion: 'Microsoft Windows 11 Pro',
    cpuModel: 'Intel(R) Core(TM) i7-12700K',
    cpuCores: 12,
    cpuThreads: 20,
    ramBytes: 34359738368,
    gpus: [],
    agentVersion: '0.2.0',
  };

  const enrollRes1 = await fetch('https://minefleet.vercel.app/api/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken: rawEnrollToken,
      machineUid,
      systemInfo: sysInfo,
    }),
  });
  const enrollData1 = await enrollRes1.json();
  console.log('Enroll Status 1:', enrollRes1.status);
  console.log('Enroll Response 1:', enrollData1);

  console.log('\n4. Testing Machine Re-Enrollment (Idempotent retry with same machineUid)...');
  const enrollRes2 = await fetch('https://minefleet.vercel.app/api/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken: rawEnrollToken,
      machineUid,
      systemInfo: sysInfo,
    }),
  });
  const enrollData2 = await enrollRes2.json();
  console.log('Enroll Status 2:', enrollRes2.status);
  console.log('Enroll Response 2:', enrollData2);

  const machineId = enrollData1.data?.machineId;
  const machineApiToken = enrollData1.data?.machineApiToken;

  console.log('\n5. Sending Heartbeat...');
  const heartbeatRes = await fetch('https://minefleet.vercel.app/api/machines/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${machineApiToken}`,
    },
    body: JSON.stringify({
      telemetry: {
        cpuPercent: 3.2,
        ramPercent: 15.4,
        gpuPercent: null,
        cpuTempC: 36,
        gpuTempC: null,
        hashrate: 0,
        miningThreads: 0,
        miningStatus: 'idle',
        powerWatts: null,
        safetyState: 'normal',
      },
      configVersion: 1,
    }),
  });
  const heartbeatData = await heartbeatRes.json();
  console.log('Heartbeat Status:', heartbeatRes.status);
  console.log('Heartbeat Data:', heartbeatData);

  console.log('\n6. Checking Fleet Dashboard...');
  const fleetRes = await fetch('https://minefleet.vercel.app/api/machines', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const fleetData = await fleetRes.json();
  const ourMachine = fleetData.data?.machines?.find((m) => m.id === machineId);
  console.log('Machine Found in Fleet:', !!ourMachine);
  console.log('Machine Name:', ourMachine?.name);
  console.log('Machine Status:', ourMachine?.status);
  console.log('Mining Active:', ourMachine?.miningActive || false);

  if (enrollRes1.status === 201 && heartbeatRes.status === 200 && ourMachine?.status === 'online') {
    console.log('\n====================================================');
    console.log('PROD ENROLLMENT AND FLEET STATUS PASS 100%!');
    console.log('====================================================');
  } else {
    console.error('\nFAIL: Verification incomplete');
  }
}

run().catch(console.error);
