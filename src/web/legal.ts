// Public Privacy Policy and Terms of Service. Google's OAuth consent screen links to both.
import { brandMark, page } from "./layout.js";

const CONTACT = "ibrahim.ansari0801@gmail.com";
const UPDATED = "October 19, 2026";
const MAIL = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;

function legalPage(title: string, intro: string, sections: [string, string][]): string {
  const body = `<div class="site">
  <nav class="site-nav"><a class="brand" href="/">${brandMark(34)}<span>ScamCheck</span></a></nav>
  <main class="legal">
    <h1>${title}</h1>
    <p class="lede">Last updated ${UPDATED}</p>
    <p>${intro}</p>
    ${sections.map(([heading, html]) => `<h2>${heading}</h2>${html}`).join("\n    ")}
  </main>
  <footer class="site-foot">
    <span><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></span>
    <span>ScamCheck</span>
  </footer>
</div>`;
  return page(`${title} · ScamCheck`, body);
}

export function privacyPage(): string {
  return legalPage(
    "Privacy Policy",
    "ScamCheck helps families spot scams in email, texts, and calls. It is built to see as little as possible. This policy explains what we collect, why, and how to delete it.",
    [
      [
        "Who this covers",
        `<ul>
          <li><b>Account holders</b>: the family member who signs up on this website and adds a parent.</li>
          <li><b>Protected people</b>: the parent or relative who connects Gmail, messages ScamCheck, or talks to it on the phone.</li>
          <li><b>Family contacts</b>: people a protected person adds to receive scam alerts.</li>
        </ul>`,
      ],
      [
        "What we store",
        `<ul>
          <li><b>Account details</b>: your name, email address, and a hashed password (we never store the password itself).</li>
          <li><b>Parent details you enter</b>: name, mobile number, preferred language, relationship, and Gmail address.</li>
          <li><b>Settings</b>: language, quiet hours, family contacts (name and phone number), and when consent was given.</li>
          <li><b>Gmail connection</b>: an encrypted access token, and the IDs of emails already checked so we don't check them twice. IDs contain no email content.</li>
          <li><b>Case summaries</b>: for each message checked, the verdict (scam, suspicious, or no red flags), a risk score, the kind of scam, the brand it claimed to be, the sender's domain, one English sentence describing it, how we notified people, and any short reply a family member sent through ScamCheck.</li>
        </ul>`,
      ],
      [
        "What we don't store",
        `<p>We do not save the text of emails or messages, attachments, images, voice notes, call recordings, or call transcripts. Content is analyzed in memory and discarded. Downloaded media is deleted right after analysis. Our logs contain IDs, verdicts, and timings, not message content, tokens, or full phone numbers.</p>`,
      ],
      [
        "How we use Gmail data",
        `<p>With permission, ScamCheck uses Google's read-only Gmail access (<code>gmail.readonly</code>). It reads new inbox emails only to check them for scams. It cannot send, delete, label, or change any email.</p>
        <p>Most ordinary emails are only counted. Emails with links, attachments, money or urgency language, or a technical red flag are sent to our AI provider for analysis. The result becomes a case summary as described above.</p>
        <p>ScamCheck's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not use Gmail data for advertising, do not sell it, do not use it to train AI models, and do not let people read it except where required by law or for security.</p>`,
      ],
      [
        "Who we share data with",
        `<p>We do not sell personal information. We use these providers only to run ScamCheck:</p>
        <ul>
          <li><b>Google</b> (Gmail API and Gemini): reading email you allowed, and analyzing suspicious messages.</li>
          <li><b>ElevenLabs</b>: turning warnings into speech, and running phone calls with the ScamCheck voice assistant.</li>
          <li><b>Photon</b>: delivering iMessages, texts, and phone calls.</li>
          <li><b>MongoDB Atlas</b>: storing the data listed above.</li>
        </ul>
        <p>Each provider handles data under its own terms. When a message looks risky, a short alert (the kind of scam, never the original message) goes to the family contacts the protected person or account holder added. Account holders see case summaries for the parents they added, not their emails.</p>`,
      ],
      [
        "Community Scam Radar",
        `<p>The public <a href="/radar">Community Scam Radar</a> shows anonymous totals only: the brand a scam pretended to be, the scammer's domain, counts, languages, and times. It never shows names, phone numbers, email addresses, summaries, or message text.</p>`,
      ],
      [
        "Deleting your data",
        `<ul>
          <li>A protected person can text <b>STOP</b> to ScamCheck at any time. This deletes their profile and case summaries and disconnects Gmail.</li>
          <li>An account holder can remove a parent from the dashboard. If no other account follows that parent, ScamCheck also stops reading their Gmail.</li>
          <li>Gmail access can be revoked anytime at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
          <li>To delete your account or ask what we hold about you, email ${MAIL}.</li>
        </ul>`,
      ],
      [
        "Security",
        `<p>Gmail tokens are encrypted, passwords are hashed, and all traffic uses HTTPS. No system is perfectly secure, so we keep only what ScamCheck needs.</p>`,
      ],
      [
        "Children",
        `<p>Account holders must be at least 18. ScamCheck is not directed at children under 13.</p>`,
      ],
      [
        "Changes and contact",
        `<p>If we change this policy, we will update the date above. Questions or requests: ${MAIL}.</p>`,
      ],
    ],
  );
}

export function termsPage(): string {
  return legalPage(
    "Terms of Service",
    "These terms apply when you use the ScamCheck website, iMessage and text service, or phone line. By using ScamCheck, you agree to them.",
    [
      [
        "What ScamCheck is",
        `<p>ScamCheck is an automated tool that uses rules and AI to check messages for signs of scams, and can alert family members you choose. It is a student project, offered free and as-is.</p>`,
      ],
      [
        "It can be wrong",
        `<p>ScamCheck can miss scams and can flag real messages by mistake. A "no red flags" result does not mean something is safe. Always confirm by contacting the company directly, using the number on your card or their official website. Never share codes or passwords. ScamCheck is not financial, legal, or security advice.</p>`,
      ],
      [
        "Not affiliated",
        `<p>ScamCheck is not affiliated with any bank, company, or government agency. Brand names appear only to describe what a message claimed to be.</p>`,
      ],
      [
        "Your responsibilities",
        `<ul>
          <li>You must be at least 18 to create an account.</li>
          <li>Only add a parent, phone number, Gmail address, or family contact with that person's permission. Each person connects their own Gmail and agrees to ScamCheck reading it.</li>
          <li>Keep your password private. You are responsible for activity on your account.</li>
          <li>Don't use ScamCheck to harass anyone, send spam, test it with real people's data without permission, or break the law.</li>
        </ul>`,
      ],
      [
        "Messages and calls",
        `<p>By giving ScamCheck a phone number, you agree that it may send texts, iMessages, voice notes, and calls to that number about scam checks, including automated warning calls for high-risk messages. Quiet hours apply except in urgent cases. Text <b>STOP</b> to stop and delete your data. Carrier message and data rates may apply.</p>`,
      ],
      [
        "Privacy",
        `<p>Our <a href="/privacy">Privacy Policy</a> explains what we collect and how to delete it.</p>`,
      ],
      [
        "No warranty and limited liability",
        `<p>ScamCheck is provided "as is" without warranties of any kind. To the fullest extent the law allows, the ScamCheck team is not liable for losses from scams, missed warnings, false alarms, service outages, or decisions made based on ScamCheck's output.</p>`,
      ],
      [
        "Ending use",
        `<p>You can stop anytime by texting STOP, removing a parent, or revoking Gmail access. We may suspend or end the service, or any account, at any time.</p>`,
      ],
      [
        "Changes and contact",
        `<p>We may update these terms and will change the date above when we do. Questions: ${MAIL}.</p>`,
      ],
    ],
  );
}
