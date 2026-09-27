/**
 * Remove API keys from any string before it is shown or logged.
 * The raw key is stripped first so regex metacharacters in the key cannot leak it.
 */
export function redactSecrets(message: string, apiKey: string | null | undefined): string {
	let out = message;
	const key = apiKey?.trim();
	if (key) {
		out = out.split(key).join('[redacted]');
		if (key !== encodeURIComponent(key)) {
			out = out.split(encodeURIComponent(key)).join('[redacted]');
		}
	}
	out = out.replace(/([?&]apiKey=)[^&\s]+/gi, '$1[redacted]');
	out = out.replace(/(api[_-]?key[\"']?\s*[:=]\s*[\"']?)[^\"'\s&,}]+/gi, '$1[redacted]');
	return out;
}
