async function testEnroll() {
  console.log('Logging in to get fresh admin session and token...');
  const loginRes = await fetch('https://minefleet.vercel.app/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@minefleet.local', password: 'Admin1234!' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken;
  console.log('Login status:', loginRes.status);

  console.log('Creating enrollment token...');
  const enrollTokenRes = await fetch('https://minefleet.vercel.app/api/enrollment-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ label: 'Diagnostic Test PC' }),
  });
  const enrollTokenData = await enrollTokenRes.json();
  const enrollmentToken = enrollTokenData.data.token;
  console.log('Enrollment token generated:', enrollmentToken);

  console.log('\n--- Case 1: Standard Payload ---');
  const res1 = await fetch('https://minefleet.vercel.app/api/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken,
      machineUid: 'mf_diag_' + Date.now().toString(16),
      systemInfo: {
        hostname: 'DIAG-PC',
        os: 'windows',
        osVersion: 'Microsoft Windows 11 Pro',
        cpuModel: 'Intel Core i9',
        cpuCores: 8,
        cpuThreads: 16,
        ramBytes: 16000000000,
        gpus: [],
        agentVersion: '0.2.0',
      },
    }),
  });
  console.log('Status Case 1:', res1.status);
  const text1 = await res1.text();
  console.log('Body Case 1:', text1);

  console.log('\n--- Case 2: PowerShell Get-CimInstance specific fields ---');
  // What PowerShell sends:
  // osVersion could be null, cpuModel could be null or object, cpuCores could be array
  const enrollTokenRes2 = await fetch('https://minefleet.vercel.app/api/enrollment-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ label: 'Diagnostic Test PC 2' }),
  });
  const enrollmentToken2 = (await enrollTokenRes2.json()).data.token;

  const res2 = await fetch('https://minefleet.vercel.app/api/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken: enrollmentToken2,
      machineUid: 'mf_diag_ps_' + Date.now().toString(16),
      systemInfo: {
        hostname: 'DESKTOP-ABC123',
        os: 'windows',
        osVersion: null,
        cpuModel: null,
        cpuCores: null,
        cpuThreads: null,
        ramBytes: null,
        gpus: null,
        agentVersion: '0.2.0',
      },
    }),
  });
  console.log('Status Case 2:', res2.status);
  const text2 = await res2.text();
  console.log('Body Case 2:', text2);

  console.log('\n--- Case 3: Malformed / Empty systemInfo ---');
  const res3 = await fetch('https://minefleet.vercel.app/api/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken: 'invalid_token_123',
      machineUid: 'mf_test',
      systemInfo: {},
    }),
  });
  console.log('Status Case 3:', res3.status);
  const text3 = await res3.text();
  console.log('Body Case 3:', text3);
}

testEnroll().catch(console.error);
