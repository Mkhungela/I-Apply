/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Password reset tool (operator use).
 *
 * Changes the password of a local account directly in the database. Useful when you
 * are locked out, when you want a simple password for a demo instance, or when you are
 * setting up a machine for someone else.
 *
 *   node tools/set-password.js <email> <new-password>
 *   node tools/set-password.js --list
 *
 * Notes:
 *  • The password is stored hashed (bcrypt) exactly as the API does it — nothing here
 *    bypasses normal authentication.
 *  • Bumping the account's token version signs out any existing sessions, which is the
 *    right behaviour after a password change.
 *  • Run it while the server is stopped, or accept that the running server will pick the
 *    new password up immediately (it reads the same database).
 */
import { initDatabase, db, closeDatabase } from '../server/src/db/index.js';
import { hashPassword } from '../server/src/lib/crypto.js';

const [, , emailArg, passwordArg] = process.argv;

function usage(message) {
  if (message) console.error(`\n✖ ${message}\n`);
  console.log('Usage:');
  console.log('  node tools/set-password.js --list');
  console.log('  node tools/set-password.js <email> <new-password>\n');
  process.exit(message ? 1 : 0);
}

async function main() {
  await initDatabase();
  const database = db();

  if (!emailArg || emailArg === '--list') {
    const users = database.all('SELECT id, email, name, created_at FROM users ORDER BY id');
    if (!users.length) {
      console.log('No accounts exist yet. Start the server and register, or use the demo sign-in.');
    } else {
      console.log(`\n${users.length} account(s):\n`);
      for (const user of users) {
        console.log(`  #${user.id}  ${user.email}${user.name ? `  (${user.name})` : ''}  — registered ${user.created_at}`);
      }
      console.log('');
    }
    if (!emailArg) {
      console.log('To change a password: node tools/set-password.js <email> <new-password>\n');
      return;
    }
  } else {
    if (!passwordArg) usage('A new password is required.');
    if (String(passwordArg).length < 6) usage('Please use at least 6 characters.');

    const user = database.get('SELECT id, email FROM users WHERE email = ?', String(emailArg).trim().toLowerCase());
    if (!user) usage(`No account with the email “${emailArg}”. Run with --list to see the accounts.`);

    const hash = await hashPassword(String(passwordArg));
    database.run(
      'UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?',
      hash,
      user.id
    );
    console.log(`\n✔ Password updated for ${user.email} (account #${user.id}).`);
    console.log('  Existing sessions for that account were signed out.');
    if (String(passwordArg).length < 8) {
      console.log('  Heads-up: that password is short. Fine for a local demo, not for an account holding real documents.');
    }
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error(`\n✖ ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
