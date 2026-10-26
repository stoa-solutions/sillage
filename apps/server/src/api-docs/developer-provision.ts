// Operator-only provisioning. Input contains a token hash, never the raw credential.
export const provisionDeveloperToken = `
import pg from 'pg';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const data = JSON.parse(input);
if (!/^[a-f0-9]{64}$/.test(data.hash) || !/^[a-f0-9-]{36}$/.test(data.id) || typeof data.email !== 'string') throw new Error('Invalid input');
const db = new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
 const user = await db.query('SELECT id FROM users WHERE lower(email)=lower($1) AND google_sub IS NOT NULL',[data.email]);
 if (user.rowCount !== 1) throw new Error('A unique existing Google account is required');
 await db.query("INSERT INTO tokens(id,name,hash,user_id,expires_at) VALUES($1,'Développement local — Postman / Swagger',$2,$3,now()+interval '90 days') ON CONFLICT(id) DO NOTHING",[data.id,data.hash,user.rows[0].id]);
 const saved = await db.query('SELECT user_id AS "userId",expires_at AS "expiresAt" FROM tokens WHERE id=$1 AND hash=$2 AND user_id=$3 AND revoked_at IS NULL',[data.id,data.hash,user.rows[0].id]);
 if (saved.rowCount !== 1) throw new Error('Development credential could not be provisioned');
 process.stdout.write(JSON.stringify(saved.rows[0]));
} finally {await db.end();}
`;
