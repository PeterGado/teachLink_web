import { EmailTemplate, EmailTemplatePayload } from '@/lib/email/types';

export type TransactionalTemplateId =
  | 'welcome'
  | 'password-reset'
  | 'email-verification'
  | 'security-alert'
  | 'course-enrollment';

const TEMPLATE_SUBJECTS: Record<TransactionalTemplateId, string> = {
  welcome: 'Welcome to TeachLink',
  'password-reset': 'Reset your TeachLink password',
  'email-verification': 'Verify your TeachLink email',
  'security-alert': 'New sign-in detected',
  'course-enrollment': 'You are enrolled successfully',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(template: string, payload: EmailTemplatePayload): string {
  return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => {
    const value = payload[key];
    return escapeHtml(value == null ? '' : String(value));
  });
}

const HTML_TEMPLATES: Record<TransactionalTemplateId, string> = {
  welcome:
    '<h2>Welcome, {{name}}</h2><p>Your TeachLink account is ready. Start learning today.</p>',
  'password-reset':
    '<h2>Password reset request</h2><p>Use this link to reset your password:</p><p><a href="{{resetUrl}}">Reset Password</a></p><p>This link expires in {{expiresInMinutes}} minutes.</p>',
  'email-verification':
    '<h2>Verify your email</h2><p>Hi {{name}}, click the link below to verify your TeachLink email:</p><p><a href="{{verificationUrl}}">Verify Email</a></p><p>This link expires in {{expiresInMinutes}} minutes.</p><p>Backup code: <strong>{{backupCode}}</strong></p><p>If you lose the link, restore verification here: <a href="{{restoreUrl}}">Restore verification</a></p>',
  'security-alert':
    '<h2>Security alert</h2><p>We noticed a sign-in from {{device}} on {{timestamp}}.</p><p>If this was not you, secure your account immediately.</p>',
  'course-enrollment':
    '<h2>Enrollment confirmed</h2><p>You are now enrolled in <strong>{{courseName}}</strong>.</p><p>Start here: <a href="{{courseUrl}}">Open course</a></p>',
};

const TEXT_TEMPLATES: Record<TransactionalTemplateId, string> = {
  welcome: 'Welcome, {{name}}. Your TeachLink account is ready.',
  'password-reset':
    'Reset your TeachLink password using this link: {{resetUrl}}. Expires in {{expiresInMinutes}} minutes.',
  'email-verification':
    'Verify your TeachLink email: {{verificationUrl}}. Expires in {{expiresInMinutes}} minutes. Backup code: {{backupCode}}. Restore here: {{restoreUrl}}',
  'security-alert':
    'Security alert: sign-in from {{device}} on {{timestamp}}. If not you, secure your account.',
  'course-enrollment': 'Enrollment confirmed for {{courseName}}. Start here: {{courseUrl}}',
};

export class EmailTemplateManager {
  getTemplate(id: TransactionalTemplateId, payload: EmailTemplatePayload): EmailTemplate {
    return {
      id,
      subject: render(TEMPLATE_SUBJECTS[id], payload),
      html: render(HTML_TEMPLATES[id], payload),
      text: render(TEXT_TEMPLATES[id], payload),
    };
  }
}

export const emailTemplateManager = new EmailTemplateManager();
