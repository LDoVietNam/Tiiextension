// test-context-bridge.mjs
// Test Context Bridge API

import http from 'node:http';

const options = {
  hostname: '127.0.0.1',
  port: 3333,
  path: '/v1/tools/fs.read',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    console.log('Response body:', data);
    const parsed = JSON.parse(data);
    if (parsed.ok) {
      console.log('\n✅ SUCCESS: File read returned content');
      console.log('Path:', parsed.result.path);
      console.log('Length:', parsed.result.length);
      console.log('Revision:', parsed.result.revision);
      console.log('Content preview:', parsed.result.content.substring(0, 100) + '...');
    } else {
      console.error('❌ FAILED:', parsed.error);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error.message);
});

const postData = JSON.stringify({
  args: {
    workspaceId: 'tiiextension',
    path: 'README.md'
  }
});

req.write(postData);
req.end();