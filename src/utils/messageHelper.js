const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');

const unwrapMessage = (message) => {
    if (!message) return {};

    let current = message;
    let guard = 0;

    while (guard < 5) {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            guard += 1;
            continue;
        }

        if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
            guard += 1;
            continue;
        }

        break;
    }

    return current;
};

const sendListMessage = async (sock, jid, title, text, footer, buttonText, sections) => {
    const msg = generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
                    header: proto.Message.InteractiveMessage.Header.create({ title: title, subtitle: "", hasMediaAttachment: false }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: [{
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: buttonText,
                                sections: sections // Array of { title: "Section", rows: [{ header, title, description, id }] }
                            })
                        }]
                    })
                })
            }
        }
    }, {});
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
};

const extractMessageText = (message) => {
    const raw = unwrapMessage(message);

    return (
        raw.conversation ||
        raw.extendedTextMessage?.text ||
        raw.imageMessage?.caption ||
        raw.videoMessage?.caption ||
        raw.buttonsResponseMessage?.selectedDisplayText ||
        raw.listResponseMessage?.title ||
        raw.templateButtonReplyMessage?.selectedDisplayText ||
        ''
    ).trim();
};

const extractSelectedId = (message) => {
    const raw = unwrapMessage(message);

    const fromListResponse = raw.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (fromListResponse) return fromListResponse;

    const fromButtonsResponse = raw.buttonsResponseMessage?.selectedButtonId;
    if (fromButtonsResponse) return fromButtonsResponse;

    const fromTemplateButton = raw.templateButtonReplyMessage?.selectedId;
    if (fromTemplateButton) return fromTemplateButton;

    const nativeFlowJson = raw.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (nativeFlowJson) {
        try {
            const parsed = JSON.parse(nativeFlowJson);
            return (parsed?.id || parsed?.selected_row_id || '').trim();
        } catch {
            return '';
        }
    }

    return '';
};

module.exports = {
    sendListMessage,
    unwrapMessage,
    extractMessageText,
    extractSelectedId,
};
