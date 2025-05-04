const bcrypt = require('bcrypt');

// Get password from command line argument
const password = process.argv[2];

if (!password) {
  console.error('Please provide a password as an argument');
  console.log('Usage: node generate-password.js YOUR_PASSWORD');
  process.exit(1);
}

const saltRounds = 10;
bcrypt.hash(password, saltRounds).then(hash => {
  console.log('Add this to your .env file:');
  console.log(`PASSWORD_HASH=${hash}`);
}).catch(err => {
  console.error('Error generating hash:', err);
});