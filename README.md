# Photocard Archive (MVP)

A Japanese-language community photocard database starter project.
Stack: React + Vite + Supabase + GitHub Pages.

## Included in this starter

- Email/password sign-up and login
- Public approved-card catalogue
- Member, album and keyword filters
- Upload-a-picture similarity search using a lightweight 64-bit average hash
- Image compression to WebP before upload
- Admin-configurable approval switches for new accounts, card records and price entries
- Pending card submissions and admin review
- Approved card detail and sold/listing price display
- Supabase RLS policies and Storage upload policy
- GitHub Actions deployment workflow

## Important limitations in this first version

1. The image search is a lightweight visual-hash similarity search, not an AI model. It works best when images have similar framing and backgrounds. It may miss the same card photographed at a different angle or crop.
2. The price-submission panel for an existing card is a placeholder in this starter. The card detail page has the working price-submission form. Use the card detail page to submit price entries.
3. Album records are intentionally not guessed. Add the album catalog in Supabase SQL Editor as an admin. Example:
   `insert into public.albums(group_id, name) select id, 'ALBUM NAME' from public.groups where name='ILLIT';`
4. This first version uses email/password authentication. It does not verify Discord server membership. Do not describe it as Discord-member-only until server-side Discord guild verification or a controlled invite flow is added.
5. The Storage bucket is public for easy card display. Pending image URLs can therefore be viewed if someone obtains the URL. For confidential moderation, change to a private bucket and signed URLs before inviting users.
6. Only admins can edit group/member/album master data. Admins are promoted manually in SQL.
7. Do not store Mercari/Yahoo Flea Market prices by scraping pages. Users enter observed prices and source URLs manually unless an approved API/integration is available.

## Setup

### 1. Install Node.js LTS

https://nodejs.org/

Check:
```bash
node -v
npm -v
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Supabase

- Create a Supabase project.
- Open SQL Editor and run `supabase/schema.sql`.
- In Storage, create a bucket named `card-images`.
- Set the bucket to Public (this is required by this starter).
- In Authentication settings, configure your site URL and allowed redirect URLs.
- Copy the Project URL and Publishable key.

Create `.env.local` in the project root, based on `.env.example`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Never use the service_role or secret key in frontend code.

### 4. Start locally

```bash
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

### 5. Create the first admin

- Sign up with your own account in the app.
- If email confirmation is enabled, confirm the email.
- In Supabase SQL Editor, run this after replacing the email:

```sql
update public.profiles
set role = 'admin', account_status = 'approved'
where id = (
  select id from auth.users
  where email = 'YOUR_EMAIL'
);
```

- Sign out and sign back in if the admin tab does not appear immediately.

### 6. Add album master data

Example:

```sql
insert into public.albums(group_id, name)
select id, 'SUPER REAL ME'
from public.groups
where name = 'ILLIT'
on conflict (group_id, name) do nothing;
```

Repeat with the album names you want to use. The admin may also add albums through SQL for this starter.

### 7. Push to GitHub

Create a public repository named `illit-card-db`, then:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/illit-card-db.git
git push -u origin main
```

In GitHub:
- Settings -> Pages -> Build and deployment -> Source: GitHub Actions
- Settings -> Secrets and variables -> Actions -> New repository secret:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

The workflow deploys on every push to `main`.

The public URL will be:
`https://YOUR_GITHUB_NAME.github.io/illit-card-db/`

### 8. Supabase Auth URL settings

Set the Site URL to your GitHub Pages URL.
Add the local URL `http://localhost:5173/**` and GitHub Pages URL to the allowed redirect URLs as needed.

## Before inviting your Discord community

- Test signup/login with a second account.
- Confirm a normal user cannot approve their own card or price entry.
- Use the admin tab to toggle approval requirements for accounts, card records and price entries.
- With account approval ON, newly registered accounts remain pending until an admin approves them. The first admin must be promoted manually and set to account_status='approved'.
- Confirm only approved cards and prices appear publicly.
- Decide whether pending images should be private. The current public bucket is convenient but not private.
- Consider adding an invite system or Discord guild membership verification.
- Add album names and any additional groups/members.
- Test image upload on iPhone and Android.
- Keep image submissions moderate; free storage has a finite quota.

## Next recommended development tasks

- Finish a dedicated price submission selector in the submit tab.
- Add admin UI for creating/editing groups, members and albums.
- Add Discord OAuth plus server-side guild membership verification if strict server membership is required.
- Switch to private image storage if pending uploads must remain confidential.
- Upgrade visual similarity search to an embedding model (e.g. browser-side image embeddings) only after testing whether average-hash search is insufficient.
- Add duplicate-card detection and report/flag tools.
