const sendListMessage = async (sock, jidOrMsg, title, text, footer, buttonTitle, sections) => {
    try {
        const isObj = typeof jidOrMsg === 'object';
        const jid = isObj ? jidOrMsg.key.remoteJid : jidOrMsg;

        // 1. Definisikan tombol List (Native Flow) ala Baileys-Mod
        const interactiveButtons = [
            {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                    title: buttonTitle,
                    sections: sections
                })
            }
        ];

        // 2. Rakit pesan dengan sintaks khusus Baileys-Mod
        const interactiveMessage = {
            body: text,
            footer: footer,
            header: { 
                title: title, 
                hasMediaAttachment: false // Gak perlu maksa pake gambar lagi!
            },
            interactiveButtons: interactiveButtons
        };

        // 3. Kirim langsung lewat sock.sendMessage
        const sentMsg = await sock.sendMessage(jid, interactiveMessage);
        console.log(`[LIST_SENT_SUCCESS] jid=${jid} messageId=${sentMsg.key.id}`);

    } catch (error) {
        console.error('[LIST_ERROR]', error);
        throw error;
    }
}

module.exports = { sendListMessage };