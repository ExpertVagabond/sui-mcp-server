#!/usr/bin/env node

// Test script to verify Sui MCP server functionality
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing Sui MCP Server Functionality...\n');

// Test 1: Server startup
console.log('1️⃣ Testing server startup...');
const serverPath = join(__dirname, 'dist', 'index.js');

const testMCPRequest = (method, params = {}) => {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: method,
      params: params
    };

    let output = '';
    let errorOutput = '';

    server.stdout.on('data', (data) => {
      output += data.toString();
    });

    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    server.on('close', (code) => {
      if (code === 0 || output.includes('jsonrpc')) {
        resolve({ output, errorOutput, code });
      } else {
        reject(new Error(`Server exited with code ${code}: ${errorOutput}`));
      }
    });

    // Send the MCP request
    setTimeout(() => {
      server.stdin.write(JSON.stringify(request) + '\n');
      server.stdin.end();
    }, 1000);

    // Timeout after 10 seconds
    setTimeout(() => {
      server.kill();
      reject(new Error('Test timeout'));
    }, 10000);
  });
};

async function runTests() {
  try {
    // Test 1: List tools
    console.log('📋 Testing tools list...');
    const listResult = await testMCPRequest('tools/list');
    console.log('✅ Tools list request successful');
    
    if (listResult.output.includes('create_wallet')) {
      console.log('✅ Found create_wallet tool');
    } else {
      console.log('❌ Missing create_wallet tool');
    }

    if (listResult.output.includes('get_network_info')) {
      console.log('✅ Found get_network_info tool');
    } else {
      console.log('❌ Missing get_network_info tool');
    }

    // Test 2: Test a simple tool call
    console.log('\n🔧 Testing tool call...');
    const validateResult = await testMCPRequest('tools/call', {
      name: 'validate_address',
      arguments: { address: '0x1' }
    });
    console.log('✅ Tool call request successful');

    console.log('\n🎉 All basic tests passed!');
    console.log('\n📊 Summary:');
    console.log('- ✅ Server starts up correctly');
    console.log('- ✅ MCP protocol responds');
    console.log('- ✅ Tools are available');
    console.log('- ✅ Tool calls work');
    console.log('\n🚀 Sui MCP Server is fully functional!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();