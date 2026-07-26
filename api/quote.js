// Vercel serverless function for quote-form submissions (homepage + business page).
// Validates the lead, then sends two emails via Resend: the lead to Zach and an
// auto-reply to the submitter. Requires the RESEND_API_KEY environment variable
// (and a verified driftstoneinsurance.com sending domain) in Vercel.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function validPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

const LEAD_TO = 'zach@driftstoneinsurance.com';
const FROM = 'Driftstone Insurance <quotes@driftstoneinsurance.com>';

const FIELD_LABELS = [
  ['coverage', 'Coverage'],
  ['bizname', 'Business name'],
  ['city', 'City'],
  ['timeline', 'Timeline'],
  ['details', 'Details'],
  ['fname', 'Name'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['pref', 'Preferred contact'],
  ['page', 'Submitted from'],
];

async function sendEmail(key, message) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error('Resend responded ' + res.status);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Honeypot: bots that fill the hidden "website" field get a fake success
  // and no email is sent.
  if (String(body.website || '').trim()) {
    return res.status(200).json({ ok: true });
  }

  const errors = {};
  if (!String(body.fname || '').trim()) errors.fname = 'Please enter your name.';
  if (!EMAIL_RE.test(String(body.email || '').trim())) errors.email = 'Please enter a valid email address.';
  if (!validPhone(body.phone)) errors.phone = 'Please enter a valid 10-digit phone number.';
  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, errors });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return res.status(500).json({ ok: false, error: 'Email service is not configured.' });
  }

  const email = String(body.email).trim();
  const fname = String(body.fname).trim();
  const lines = FIELD_LABELS
    .filter(([k]) => String(body[k] || '').trim())
    .map(([k, label]) => label + ': ' + String(body[k]).trim());

  try {
    await sendEmail(key, {
      from: FROM,
      to: [LEAD_TO],
      reply_to: email,
      subject: 'New quote request — ' + (body.coverage || 'general') + ' — ' + fname,
      text: lines.join('\n'),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: 'Could not deliver your request. Please email ' + LEAD_TO + ' or call 442-359-5633.',
    });
  }

  // Auto-reply is best-effort: the lead is already delivered, so a failure
  // here should not surface as an error to the visitor.
  try {
    await sendEmail(key, {
      from: FROM,
      to: [email],
      subject: 'We received your quote request — Driftstone Insurance',
      text:
        'Hi ' + fname + ',\n\n' +
        "Thanks for reaching out — your quote request is in. We'll review your details " +
        'and get back to you with options from carriers that fit, usually within one business day.\n\n' +
        'If anything is time-sensitive, call us at 442-359-5633.\n\n' +
        'Driftstone Insurance Solutions\n' +
        'Independent insurance · North County San Diego\n' +
        'CA License #4168429',
    });
  } catch (err) {
    // intentionally swallowed — see comment above
  }

  return res.status(200).json({ ok: true });
};
