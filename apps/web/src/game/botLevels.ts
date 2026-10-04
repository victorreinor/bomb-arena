import { BOT_LEVELS, type BotLevel } from "@bomberman/engine";

export const BOT_LEVEL_NAMES: Record<BotLevel, string> = { easy: "Fácil", normal: "Normal", hard: "Difícil" };
export const BOT_LEVEL_OPTIONS = BOT_LEVELS.map((value) => ({ value, label: BOT_LEVEL_NAMES[value] }));

/** The level after this one, round and round (the host clicks a bot's level to change it). */
export const nextBotLevel = (level: BotLevel): BotLevel => BOT_LEVELS[(BOT_LEVELS.indexOf(level) + 1) % BOT_LEVELS.length];
