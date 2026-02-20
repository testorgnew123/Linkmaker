import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(url);

const email = 'admin@desirerealty.co.za';
const password = 'password123';
const passwordHash = await bcrypt.hash(password, 10);

console.log('Seeding test user...');

// Upsert user
let userRows = await sql`SELECT id FROM users WHERE email = ${email}`;
let userId;

if (userRows.length > 0) {
  userId = userRows[0].id;
  console.log(`  User already exists: ${userId}`);
} else {
  const inserted = await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id
  `;
  userId = inserted[0].id;
  console.log(`  Created user: ${userId}`);
}

console.log('Seeding Desire Realty profile...');

const slug = 'desire-realty';

const socials = JSON.stringify([
  { id: 'whatsapp', label: 'WhatsApp', icon: '\ud83d\udcac', color: '#25D366', value: '+27000000000', enabled: true },
  { id: 'instagram', label: 'Instagram', icon: '\ud83d\udcf8', color: '#E1306C', value: '@desirerealty', enabled: true },
  { id: 'facebook', label: 'Facebook', icon: '\ud83d\udc4d', color: '#1877F2', value: 'desirerealty', enabled: true },
  { id: 'phone', label: 'Phone', icon: '\ud83d\udcde', color: '#34a853', value: '+27000000000', enabled: true },
  { id: 'maps', label: 'Maps', icon: '\ud83d\udccd', color: '#EA4335', value: 'Johannesburg, SA', enabled: true },
  { id: 'website', label: 'Website', icon: '\ud83c\udf10', color: '#6c63ff', value: 'https://desirerealty.co.za', enabled: true },
  { id: 'email', label: 'Email', icon: '\u2709\ufe0f', color: '#f59e0b', value: 'info@desirerealty.co.za', enabled: true },
  { id: 'tiktok', label: 'TikTok', icon: '\ud83c\udfb5', color: '#69C9D0', value: '', enabled: false },
  { id: 'linkedin', label: 'LinkedIn', icon: '\ud83d\udcbc', color: '#0A66C2', value: '', enabled: false },
  { id: 'youtube', label: 'YouTube', icon: '\u25b6\ufe0f', color: '#FF0000', value: '', enabled: false },
]);

const cards = JSON.stringify([
  { id: 1, type: 'whatsapp', title: 'Chat on WhatsApp', sub: 'Get instant assistance', phone: '+27000000000', message: 'Hi, I am interested in a property' },
  { id: 2, type: 'website', title: 'Our Website', url: 'https://desirerealty.co.za', view: 'card' },
  { id: 3, type: 'map', title: 'Find Our Office', address: 'Johannesburg, South Africa', lat: '-26.195', lng: '28.034', view: 'card' },
  { id: 4, type: 'google', title: 'Leave a Review', biz: 'Desire Realty', rating: '5.0', reviews: '124', url: 'https://business.google.com' },
  { id: 5, type: 'cta', title: 'Premium Stands Available', badge: '\ud83d\udd25 Featured Listing', desc: 'Secure your piece of premium land. Flexible payment plans for qualifying buyers.', btnText: 'View Properties', url: 'https://desirerealty.co.za/listings' },
  { id: 6, type: 'link', title: 'Book a Consultation', sub: 'Free 30-min property advice', icon: '\ud83d\udcc5', url: 'https://calendly.com', view: 'card' },
  { id: 7, type: 'text', title: 'About Desire Realty', content: 'We are a premium real estate company based in Johannesburg, specializing in residential and land sales.' },
  { id: 8, type: 'video', title: 'Property Showcase', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', view: 'card' },
]);

// Upsert profile
const existingProfile = await sql`SELECT id FROM profiles WHERE slug = ${slug}`;

if (existingProfile.length > 0) {
  await sql`
    UPDATE profiles SET
      owner_id = ${userId},
      business_name = ${'Desire Realty'},
      tagline = ${'Premium Land & Residential'},
      bio = ${'Crafting exceptional living spaces with a commitment to quality and innovation.'},
      initials = ${'DR'},
      emoji = ${'\ud83c\udfe0'},
      avatar_style = ${'initials'},
      theme = ${'midnight'},
      socials = ${socials}::jsonb,
      cards = ${cards}::jsonb
    WHERE slug = ${slug}
  `;
  console.log(`  Updated existing profile: ${slug}`);
} else {
  await sql`
    INSERT INTO profiles (slug, owner_id, business_name, tagline, bio, initials, emoji, avatar_style, theme, socials, cards)
    VALUES (${slug}, ${userId}, ${'Desire Realty'}, ${'Premium Land & Residential'},
            ${'Crafting exceptional living spaces with a commitment to quality and innovation.'},
            ${'DR'}, ${'\ud83c\udfe0'}, ${'initials'}, ${'midnight'},
            ${socials}::jsonb, ${cards}::jsonb)
  `;
  console.log(`  Created profile: ${slug}`);
}

// ── Admin user ───────────────────────────────────────────────────────────────
// Seeded manually only — there is no API path to become admin.
// Requires: ADMIN_PASSWORD env var and migration 003 already applied.

const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.warn('\nWARNING: ADMIN_PASSWORD is not set — skipping admin user seed.');
  console.warn('  Set ADMIN_PASSWORD in .env and re-run to create the admin account.');
} else {
  const adminEmail = 'admin@qrprofile.com';
  const adminHash  = await bcrypt.hash(adminPassword, 12);

  console.log('\nSeeding admin user...');

  const existingAdmin = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;

  if (existingAdmin.length > 0) {
    // Update password and ensure role is admin in case it drifted
    await sql`
      UPDATE users SET password_hash = ${adminHash}, role = 'admin'
      WHERE email = ${adminEmail}
    `;
    console.log(`  Updated admin user: ${adminEmail}`);
  } else {
    await sql`
      INSERT INTO users (email, password_hash, role)
      VALUES (${adminEmail}, ${adminHash}, 'admin')
    `;
    console.log(`  Created admin user: ${adminEmail}`);
  }

  console.log(`  Login: ${adminEmail} / [value of ADMIN_PASSWORD]`);
  console.log('  Admin portal: /admin/');
}

// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSeed complete!');
console.log(`  Test login: ${email} / ${password}`);
console.log(`  Profile: /p/${slug}`);
