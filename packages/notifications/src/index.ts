import nodemailer from "nodemailer";
import {
  maybeEnv,
  requiredEnv,
  UnauthorizedError,
  type NotificationDeliveryResult,
  type NotificationMessage
} from "@tenderlo/shared";

export interface NotificationProviderContext {
  smtp?: {
    host: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
  };
  whatsapp?: {
    token: string;
    phoneNumberId: string;
    defaultTemplate: string;
  };
}

export function loadNotificationContextFromEnv(): NotificationProviderContext {
  const smtpHost = maybeEnv("SMTP_HOST");
  const smtpPort = maybeEnv("SMTP_PORT");
  const whatsappToken = maybeEnv("META_WHATSAPP_TOKEN");
  const whatsappPhoneNumberId = maybeEnv("META_WHATSAPP_PHONE_NUMBER_ID");

  const context: NotificationProviderContext = {};
  if (smtpHost) {
    const smtpUser = maybeEnv("SMTP_USER");
    const smtpPass = maybeEnv("SMTP_PASS");
    context.smtp = {
      host: smtpHost,
      port: smtpPort ? Number(smtpPort) : 587,
      from: maybeEnv("SMTP_FROM") ?? "TenderLo <alerts@tenderlo.local>",
      ...(smtpUser ? { user: smtpUser } : {}),
      ...(smtpPass ? { pass: smtpPass } : {})
    };
  }
  if (whatsappToken && whatsappPhoneNumberId) {
    context.whatsapp = {
      token: whatsappToken,
      phoneNumberId: whatsappPhoneNumberId,
      defaultTemplate: maybeEnv("META_WHATSAPP_DEFAULT_TEMPLATE") ?? "tender_alert"
    };
  }
  return context;
}

export async function sendNotification(
  message: NotificationMessage,
  context: NotificationProviderContext = loadNotificationContextFromEnv()
): Promise<NotificationDeliveryResult> {
  if (message.channel === "email") return sendEmailNotification(message, context);
  if (message.channel === "whatsapp") return sendWhatsAppNotification(message, context);
  return {
    status: "sent",
    providerMessageId: `in-app-${Date.now()}`
  };
}

export async function sendEmailNotification(
  message: NotificationMessage,
  context: NotificationProviderContext = loadNotificationContextFromEnv()
): Promise<NotificationDeliveryResult> {
  if (!context.smtp) {
    return { status: "failed", error: "SMTP is not configured." };
  }
  if (!message.to) {
    return { status: "failed", error: "Email notification is missing recipient." };
  }

  const transporter = nodemailer.createTransport({
    host: context.smtp.host,
    port: context.smtp.port,
    secure: context.smtp.port === 465,
    auth: context.smtp.user
      ? {
          user: context.smtp.user,
          pass: context.smtp.pass
        }
      : undefined
  });

  const info = await transporter.sendMail({
    from: context.smtp.from,
    to: message.to,
    subject: message.title,
    text: buildPlainTextEmail(message),
    html: buildHtmlEmail(message)
  });

  return {
    status: "sent",
    providerMessageId: info.messageId
  };
}

export async function sendWhatsAppNotification(
  message: NotificationMessage,
  context: NotificationProviderContext = loadNotificationContextFromEnv()
): Promise<NotificationDeliveryResult> {
  if (!context.whatsapp) {
    return { status: "failed", error: "Meta WhatsApp Cloud API is not configured." };
  }
  if (!message.to) {
    return { status: "failed", error: "WhatsApp notification is missing recipient phone number." };
  }

  const template = String(message.metadata?.template ?? context.whatsapp.defaultTemplate);
  const response = await fetch(`https://graph.facebook.com/v20.0/${context.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.whatsapp.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: message.to,
      type: "template",
      template: {
        name: template,
        language: {
          code: String(message.metadata?.languageCode ?? "en")
        },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: message.title },
              { type: "text", text: message.body.slice(0, 900) }
            ]
          }
        ]
      }
    })
  });

  const payload = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) {
    return {
      status: "failed",
      error: payload.error?.message ?? `Meta WhatsApp API returned ${response.status}`
    };
  }

  return payload.messages?.[0]?.id
    ? {
        status: "sent",
        providerMessageId: payload.messages[0].id
      }
    : {
        status: "sent"
      };
}

export function buildPlainTextEmail(message: NotificationMessage): string {
  return `${message.title}\n\n${message.body}\n\nTenderLo provides bid-readiness intelligence, not legal advice. Verify tender requirements before submitting a bid.`;
}

export function buildHtmlEmail(message: NotificationMessage): string {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#10201a">
      <h1 style="font-size:20px;margin:0 0 12px"> ${escapeHtml(message.title)} </h1>
      <p>${escapeHtml(message.body)}</p>
      <p style="font-size:12px;color:#5f6f68">TenderLo provides bid-readiness intelligence, not legal advice. Verify tender requirements before submitting a bid.</p>
    </div>
  `;
}

export function assertWorkerSecret(value: string | null): void {
  const expected = requiredEnv("WORKER_SHARED_SECRET");
  if (!value || value !== expected) {
    throw new UnauthorizedError("Invalid worker shared secret.");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
