/*
Copyright 2018 - 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { MsgType } from "./@types/event.ts";
import { type IMessageRendering, M_TEXT } from "./@types/extensible_events.ts";
import { type MRoomTopicEventContent, type MTopicContent, M_TOPIC, type MTopicEvent } from "./@types/topic.ts";
import { type RoomMessageEventContent } from "./@types/events.ts";

/**
 * Utility to check if a value is provided (not null or undefined)
 */
function isProvided(value: any): boolean {
    return value !== null && value !== undefined;
}

/**
 * Generates the content for a HTML Message event
 * @param body - the plaintext body of the message
 * @param htmlBody - the HTML representation of the message
 * @returns
 */
export function makeHtmlMessage(body: string, htmlBody: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Text,
        format: "org.matrix.custom.html",
        body: body,
        formatted_body: htmlBody,
    };
}

/**
 * Generates the content for a HTML Notice event
 * @param body - the plaintext body of the notice
 * @param htmlBody - the HTML representation of the notice
 * @returns
 */
export function makeHtmlNotice(body: string, htmlBody: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Notice,
        format: "org.matrix.custom.html",
        body: body,
        formatted_body: htmlBody,
    };
}

/**
 * Generates the content for a HTML Emote event
 * @param body - the plaintext body of the emote
 * @param htmlBody - the HTML representation of the emote
 * @returns
 */
export function makeHtmlEmote(body: string, htmlBody: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Emote,
        format: "org.matrix.custom.html",
        body: body,
        formatted_body: htmlBody,
    };
}

/**
 * Generates the content for a Plaintext Message event
 * @param body - the plaintext body of the emote
 * @returns
 */
export function makeTextMessage(body: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Text,
        body: body,
    };
}

/**
 * Generates the content for a Plaintext Notice event
 * @param body - the plaintext body of the notice
 * @returns
 */
export function makeNotice(body: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Notice,
        body: body,
    };
}

/**
 * Generates the content for a Plaintext Emote event
 * @param body - the plaintext body of the emote
 * @returns
 */
export function makeEmoteMessage(body: string): RoomMessageEventContent {
    return {
        msgtype: MsgType.Emote,
        body: body,
    };
}

/**
 * Topic event helpers
 */
export type MakeTopicContent = (topic: string | null | undefined, htmlTopic?: string) => MRoomTopicEventContent;

export const makeTopicContent: MakeTopicContent = (topic, htmlTopic) => {
    const renderings = [];
    // Put HTML first because clients will render the first type in
    // the array that they understand
    if (isProvided(htmlTopic)) {
        renderings.push({ body: htmlTopic, mimetype: "text/html" });
    }
    if (isProvided(topic)) {
        renderings.push({ body: topic, mimetype: "text/plain" });
    }
    return { topic, [M_TOPIC.name]: { "m.text": renderings } };
};

export type TopicState = {
    text?: string;
    html?: string;
};

export const parseTopicContent = (content: MRoomTopicEventContent): TopicState => {
    const mtopicParent = M_TOPIC.findIn<MTopicContent | IMessageRendering[]>(content as MTopicEvent);
    const mtopic = Array.isArray(mtopicParent) ? mtopicParent : mtopicParent?.["m.text"];
    // TODO remove support for the old malformed m.topic arrays after a few releases (only allow array in m.text)
    //      https://github.com/matrix-org/matrix-js-sdk/pull/4984#pullrequestreview-3174251065
    //const mtopic = M_TOPIC.findIn<MTopicContent>(content)?.["m.text"];
    if (!Array.isArray(mtopic)) {
        return { text: content.topic ?? undefined };
    }
    const text =
        mtopic?.find((r) => !isProvided(r.mimetype) || r.mimetype === "text/plain")?.body ?? content.topic ?? undefined;
    const html = mtopic?.find((r) => r.mimetype === "text/html")?.body;
    return { text, html };
};
