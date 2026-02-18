/* eslint-disable @typescript-eslint/no-require-imports */
// Run this script to validate your environment variables
// Usage: node scripts/check-env.js

require('dotenv').config({ path: '.env' });

const requiredEnvVars = {
  'NEXT_PUBLIC_SUPABASE_URL': {
    description: 'Supabase project URL',
    example: 'https://xxxxxxxxxxxxx.supabase.co',
    validate: (val) => val.startsWith('https://') && val.includes('.supabase.co')
  },
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': {
    description: 'Supabase anonymous key',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    validate: (val) => val.length > 100 && val.startsWith('eyJ')
  },
  'CLOUDFLARE_R2_ACCOUNT_ID': {
    description: 'Cloudflare account ID',
    example: 'abc123def456',
    validate: (val) => val.length > 10
  },
  'CLOUDFLARE_R2_ACCESS_KEY_ID': {
    description: 'R2 access key ID',
    example: '1234567890abcdef',
    validate: (val) => val.length > 10
  },
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY': {
    description: 'R2 secret access key',
    example: 'abcdefghijklmnopqrstuvwxyz123456',
    validate: (val) => val.length > 20
  },
  'CLOUDFLARE_R2_BUCKET_NAME': {
    description: 'R2 bucket name',
    example: 'my-social-spark-bucket',
    validate: (val) => val.length > 0
  },
  'CLOUDFLARE_R2_PUBLIC_URL': {
    description: 'R2 public URL for accessing uploaded files',
    example: 'https://pub-xxxxx.r2.dev',
    validate: (val) => val.startsWith('https://')
  },
  'GOOGLE_GEMINI_API_KEY': {
    description: 'Google Gemini API key',
    example: 'AIzaSy...',
    validate: (val) => val.length > 20
  }
};

const optionalProxyEnvVars = {
  'DECODO_PROXY_HOST': {
    description: 'Decodo proxy host',
    example: 'isp.decodo.com',
  },
  'DECODO_PROXY_PORT': {
    description: 'Decodo proxy port',
    example: '10001',
  },
  'DECODO_PROXY_USERNAME': {
    description: 'Decodo proxy username',
    example: 'customer-xxxx-zone-xxxx',
  },
  'DECODO_PROXY_PASSWORD': {
    description: 'Decodo proxy password',
    example: 'your_proxy_password',
  },
  'DECODO_PROXY_USE_SESSION': {
    description: 'Use rotating Decodo sessions per retry',
    example: 'true',
  },
  'SOCIAL_EXTRACTOR_API_URL': {
    description: 'Remote extractor service base URL',
    example: 'https://api.yourdomain.com',
  },
  'SOCIAL_EXTRACTOR_API_TOKEN': {
    description: 'Bearer token for remote extractor service',
    example: 'your_shared_secret_token',
  },
};

console.log('🔍 Checking environment variables from .env file...\n');

let hasErrors = false;

Object.entries(requiredEnvVars).forEach(([key, config]) => {
  const value = process.env[key];
  
  if (!value || value.trim() === '') {
    console.log(`❌ ${key}`);
    console.log(`   Missing or empty`);
    console.log(`   Description: ${config.description}`);
    console.log(`   Example: ${config.example}\n`);
    hasErrors = true;
  } else if (!config.validate(value)) {
    console.log(`⚠️  ${key}`);
    console.log(`   Invalid format: ${value.substring(0, 30)}...`);
    console.log(`   Description: ${config.description}`);
    console.log(`   Example: ${config.example}\n`);
    hasErrors = true;
  } else {
    console.log(`✅ ${key}`);
    console.log(`   ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}\n`);
  }
});

console.log('\n🔍 Optional Decodo proxy variables (recommended for Instagram/TikTok scraping):\n');

const hasAllProxyVars = Object.keys(optionalProxyEnvVars).every(
  (key) => process.env[key] && process.env[key].trim() !== ''
);

if (hasAllProxyVars) {
  Object.keys(optionalProxyEnvVars).forEach((key) => {
    console.log(`✅ ${key}`);
  });
} else {
  Object.entries(optionalProxyEnvVars).forEach(([key, config]) => {
    if (!process.env[key] || process.env[key].trim() === '') {
      console.log(`ℹ️  ${key} (not set)`);
      console.log(`   ${config.description}`);
      console.log(`   Example: ${config.example}\n`);
    }
  });
}

if (hasErrors) {
  console.log('\n❌ Some environment variables are missing or invalid.');
  console.log('Please check your .env file and fix the issues above.\n');
  process.exit(1);
} else {
  console.log('\n✅ All environment variables are set correctly!\n');
  process.exit(0);
}
