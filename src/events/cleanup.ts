import { DURATION_TMP_EMOJI } from '@constants';
import type { BotEvent } from '@events';

/*
 * @event       - onReady - Cleanup
 * @description - Gestion de la suppression des emojis temporaires
 * @permission  - None
 */
export const CLEANUP: BotEvent = {
    name: 'Clean up temporary emojis',
    listenTo: 'ready',
    async execute(client) {
        // Gestion de la suppression des emojis temporaires
        const guilds = await client.guilds.fetch();
        for await (const oauth2guild of guilds.values()) {
            const guild = await oauth2guild.fetch();
            console.log(`Cleanup ${guild.name}`);
            const emojis = await guild.emojis.fetch();
            for await (const emoji of emojis.values()) {
                console.log(`Cleanup emoji ${emoji.name}`);
                if (!emoji.name?.startsWith('tmp_')) {
                    continue;
                }
                const timestamp = /tmp_(\d+)/.exec(emoji.name)?.[1];
                if (!timestamp) {
                    continue;
                }
                const diff = Math.max(0, DURATION_TMP_EMOJI - (Date.now() - Number(timestamp)));
                setTimeout(() => void emoji.delete(), diff);
            }
        }
    },
    once: true,
};
