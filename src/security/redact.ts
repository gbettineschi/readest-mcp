/** Diagnostics only: never rewrite quoted book content. */
export function redact(message:string):string {
  return message.replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
    .replace(/([?&](?:token|access_token|refresh_token|signature|X-Amz-Signature)=)[^&\s]+/gi,'$1[redacted]')
    .replace(/((?:password|access_token|refresh_token|api_key)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
}
