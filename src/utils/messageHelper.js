const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');

const buildFallbackMenuText = (title, text, sections) => {
    const lines = [title, text, ''];
    const safeSections = Array.isArray(sections) ? sections : [];

    for (const section of safeSections) {
        if (section?.title) {
            lines.push(`${section.title}`);
        }

        const rows = Array.isArray(section?.rows) ? section.rows : [];
        for (const row of rows) {
            lines.push(`- ${row.title} (${row.id})`);
            if (row.description) lines.push(`  ${row.description}`);
        }

        lines.push('');
    }

    lines.push('Balas dengan ID di dalam kurung untuk memilih menu.');
    return lines.join('\n').trim();
};

const sendListMessage = async (sock, jid, title, text, footer, buttonTitle, sections, quotedMsg = null) => {
    // sections structure must be: [{ title: "...", highlight_label: "...", rows: [{ title: "...", description: "...", id: "..." }] }]
    const msg = await generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2
                },
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
                    header: proto.Message.InteractiveMessage.Header.create({
                        title: title,
                        subtitle: "",
                        hasMediaAttachment: false
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: [
                            {
                                name: "single_select",
                                buttonParamsJson: JSON.stringify({
                                    title: buttonTitle,
                                    sections: sections
                                })
                            }
                        ],
                    })
                })
            }
        }
    }, { quoted: quotedMsg });

    try {
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        console.log(`[LIST_SENT] jid=${jid} messageId=${msg.key.id} rows=${sections?.[0]?.rows?.length || 0}`);

        const shouldFallbackToText = jid.endsWith('@lid') || process.env.FORCE_TEXT_MENU === '1';
        if (shouldFallbackToText) {
            await sock.sendMessage(jid, {
                text: buildFallbackMenuText(title, text, sections),
            });
            console.log(`[LIST_FALLBACK_TEXT] jid=${jid} reason=${jid.endsWith('@lid') ? 'lid-client' : 'forced'}`);
        }
    } catch (error) {
        console.error('[LIST_ERROR]', error);
        throw error;
    }
}

module.exports = { sendListMessage };
