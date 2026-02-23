const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

// Fungsi pembantu untuk fallback teks biasa
const buildFallbackMenuText = (title, text, sections) => {
    const lines = [title, text, ''];
    const safeSections = Array.isArray(sections) ? sections : [];

    for (const section of safeSections) {
        if (section?.title) lines.push(`${section.title}`);
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

const sendListMessage = async (sock, jidOrMsg, title, text, footer, buttonTitle, sections, quotedMsg = null) => {
    
    // --- FIX FATAL NYA DI SINI --- 
    // Ngecek apakah parameter ke-2 itu objek 'msg' atau string 'jid'
    const jid = typeof jidOrMsg === 'object' ? jidOrMsg.key.remoteJid : jidOrMsg;

    // 1. Trik Gambar Header (WAJIB biar button nampil di Android/iOS)
    const mediaMsg = await prepareWAMessageMedia(
        { image: { url: "https://telegra.ph/file/6880771a42bad09dd6087.jpg" } }, 
        { upload: sock.waUploadToServer }
    );

    // 2. Trik Business Owner JID biar gak undefined
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    // 3. Rakit pesan Native Flow
    const msg = generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2
                },
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    // Trik Context Info
                    contextInfo: {
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterName: "Smart Public Service", 
                            newsletterJid: "120363144038483540@newsletter",
                            serverMessageId: -1
                        },
                        businessMessageForwardInfo: { businessOwnerJid: botJid },
                    },
                    body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
                    header: proto.Message.InteractiveMessage.Header.create({
                        title: title,
                        subtitle: "",
                        hasMediaAttachment: true, 
                        ...mediaMsg 
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
    } catch (error) {
        console.error('[LIST_ERROR]', error);
        throw error;
    }
}

module.exports = { sendListMessage };