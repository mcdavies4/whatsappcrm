// Sends the magic-link email via Resend (the same provider used in Sitewatch).
// If RESEND_API_KEY isn't set, we don't email — instead the request route
// returns the link directly (dev convenience) so you can still log in.

export async function sendMagicLink(to: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM; // e.g. "Nowrumble <login@yourdomain>"
  if (!key || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: 'Your sign-in link',
      html: `<p>Tap to sign in and start logging calls:</p>
             <p><a href="${link}">Sign in</a></p>
             <p>This link expires in 15 minutes and can be used once.</p>`,
    }),
  });
  if (!res.ok) {
    console.error('Resend send failed', res.status, await res.text());
    return false;
  }
  return true;
}
