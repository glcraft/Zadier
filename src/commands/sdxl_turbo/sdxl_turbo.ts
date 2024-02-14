import type { Command } from '@commands';
import { SlashCommandBuilder } from 'discord.js';

import * as hugging_face from './hugging_face.ts';

interface Attachment {
    name: string;
    attachment: Buffer;
}

async function getRoot(): Promise<Option<string>> {
    const res = await fetch('https://diffusers-unofficial-sdxl-turbo-i2i-t2i.hf.space/?__theme=light', {
        method: 'GET',
    });
    if (res.status != 200) {
        return null;
    }
    const html = await res.text();

    const reg = /(https:\/\/diffusers-unofficial-sdxl-turbo-i2i-t2i.hf.space\/--replicas\/\w+)/s.exec(html);
    if (!reg?.[1]) {
        return null;
    }
    return reg[1];
}

let ROOT: Option<string> = await getRoot();

async function getFileFromRoot(path: string, force: boolean = true): Promise<Option<ArrayBuffer>> {
    if (!ROOT) {
        await getRoot();
        if (!ROOT) {
            return null;
        }
    }
    const res = await fetch(`${ROOT}/file=${path}`);
    if (res.status == 404 && !force) {
        ROOT = null;
        return getFileFromRoot(path, false);
    } else if (res.status != 200) {
        return null;
    }
    return res.arrayBuffer();
}

function intoEvent(value_string: string): hugging_face.Event | null {
    const reg = /data: (.*)/.exec(value_string);
    if (!reg?.[1]) {
        return null;
    }
    const data = reg[1];
    const parsed = JSON.parse(data) as hugging_face.Event;
    return parsed;
}

class EventReader {
    private img: Option<Attachment> = null;
    public constructor(
        private reader: ReadableStreamDefaultReader<Uint8Array>,
        private data: hugging_face.Input,
    ) {}
    public image(): Option<typeof this.img> {
        return this.img;
    }

    public async process(): Promise<void> {
        for (;;) {
            const evt = await this.reader.read();
            if (evt.done) {
                return;
            }
            const value_string = new TextDecoder('utf-8').decode(evt.value);
            for (const line of value_string.split('\n')) {
                if (line === '') {
                    continue;
                }
                const evt = intoEvent(line);
                if (!evt) {
                    continue;
                }
                if (!(await this.processEvent(evt))) {
                    return;
                }
            }
        }
    }
    private async processEvent(evt: hugging_face.Event): Promise<boolean> {
        switch (evt.msg) {
            // case "estimation":
            //     break;
            case 'send_data':
                if (
                    !(await hugging_face.send_data(evt.event_id, this.data.session_hash, [
                        null,
                        this.data.prompt,
                        this.data.strength,
                        this.data.steps,
                        this.data.seed,
                    ]))
                ) {
                    return false;
                }
                break;
            // case "process_starts":
            //     break;
            case 'process_completed':
                if (evt.success) {
                    const data = evt.output?.data[0];
                    if (!data) {
                        return false;
                    }
                    const res = await getFileFromRoot(data.path);
                    if (!res) {
                        return false;
                    }
                    this.img = {
                        name: data.orig_name,
                        attachment: Buffer.from(res),
                    };
                }
                break;
        }
        return true;
    }
}

/*
 * @command     - sdxl_turbo
 * @description - Génère des images avec SDLXL Turbo!
 * @permission  - None
 */
export const SDXL_TURBO: Command = {
    data: new SlashCommandBuilder()
        .setName('sdxl_turbo')
        .setDescription('Génère des images avec SDLXL Turbo!')
        .addStringOption((option) => option.setName('prompt').setDescription('Le prompt').setRequired(true))
        .addNumberOption((option) =>
            option.setName('strength').setDescription('La force du bruitage (0.7 par défaut)').setRequired(false),
        )
        .addNumberOption((option) =>
            option.setName('steps').setDescription("Le nombre d'étapes (2 par défaut)").setRequired(false),
        )
        .addNumberOption((option) =>
            option.setName('seed').setDescription('La graine (aléatoire par défaut)').setRequired(false),
        ),
    async execute(interaction) {
        const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

        await interaction.deferReply();
        const replyError = async (msgError: string): Promise<void> => {
            await interaction.editReply(msgError);
        };

        // Discord slash command parameters
        const prompt = interaction.options.get('prompt')?.value as string;
        const seed = (interaction.options.get('seed')?.value as number) || Math.floor(Math.random() * 12013012031030);
        const strength = (interaction.options.get('strength')?.value as number) || 0.7;
        const steps = (interaction.options.get('steps')?.value as number) || 2;
        if (!prompt) {
            return replyError('No prompt provided');
        }

        let session_hash = '';
        for (let i = 0; i < 10; i++) {
            session_hash += CHARS[Math.floor(Math.random() * CHARS.length)];
        }
        const response = await fetch(
            `https://diffusers-unofficial-sdxl-turbo-i2i-t2i.hf.space/queue/join?__theme=light&fn_index=1&session_hash=${session_hash}`,
            {
                headers: {
                    Accept: 'text/event-stream',
                },
                method: 'GET',
            },
        );
        if (!response.body) {
            return replyError('fetch has no body');
        }
        const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;

        const event_reader = new EventReader(reader, {
            session_hash,
            prompt,
            strength,
            steps,
            seed,
        });

        await event_reader.process();

        const image = event_reader.image();
        if (image) {
            await interaction.editReply({
                content: interaction.options.get('seed') === null ? `Graine: ${seed}` : null,
                files: [image],
            });
        } else {
            await interaction.editReply('Un problème est survenu...');
        }
    },
};
