export async function send({
	postmarkToken,
	recipient,
	sender,
	template,
	templateData,
}: {
	postmarkToken: string;
	recipient: string;
	sender?: string;
	template: string;
	templateData: Record<string, any>;
}) {
	const email = sender || 'no-reply@fireproof.storage';
	const rsp = await fetch('https://api.postmarkapp.com/email/withTemplate', {
		method: 'POST',
		headers: {
			Accept: 'text/json',
			'Content-Type': 'text/json',
			'X-Postmark-Server-Token': postmarkToken,
		},
		body: JSON.stringify({
			From: `Fireproof <${email}>`,
			To: recipient,
			TemplateAlias: template,
			TemplateModel: templateData,
		}),
	});

	if (!rsp.ok) {
		throw new Error(`Send email failed with status: ${rsp.status}, body: ${await rsp.text()}`);
	}
}
