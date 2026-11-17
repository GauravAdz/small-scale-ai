---
slug: linzsings
title: LinzSings
type: project
weight: 100
year: 2026
status: live
role: Developer
summary: A first-prize project from the Ars Electronica Festival 2026 AI Hackathon that hides City of Linz street-record IDs inside music and reveals local stories through on-device audio decoding.
tags: [Next.js, React, TypeScript, Web Audio API, Audio Signal Processing, Open Data, Data Storytelling, AI-assisted Development]
url: https://linz-cipher.vercel.app
repo: https://github.com/GauravAdz/linz-cipher
featured: true
---

# LinzSings

I developed LinzSings for the official AI Hackathon at Ars Electronica Festival
2026, held on September 11 and 12 at Grand Garage in Linz. The project won first
prize through the event's community vote.

## The Experience

LinzSings turns the history of Linz streets and public places into a listening
experience. A transmitter plays ambient music containing a hidden identifier
for a City of Linz street record. A visitor opens the app on another phone,
listens through the microphone, and sees the matching English-language story
after the signal has been decoded and verified.

The project uses the City of Linz open-data street catalogue, including current
and historical street names. It offers a way to discover the city through
sound instead of searching for a street name or scanning a code.

## How It Works

The live protocol encodes each record as a packet carried by four musical
frequencies. The browser finds the packet timing and preamble, decodes the
payload, checks its CRC, and matches the resulting Sonic ID against a local
public dataset before showing the place story.

Audio analysis runs entirely in the browser. The app does not record or upload
microphone audio, and the listening flow makes no API request after its data
bundle has loaded.

## Data and Stack

The repository includes a deterministic pipeline that normalizes 1,575 current
and historical records from the City of Linz street catalogue. It also includes
an optional source-grounded Mistral preprocessing path for editorial stories;
the live experience does not depend on an AI model.

The main stack is Next.js 16, React 19, TypeScript, Tone.js, the Web Audio API,
Zod, Vitest, and Playwright. The project is live at
[linz-cipher.vercel.app](https://linz-cipher.vercel.app), and the source is on
[GitHub](https://github.com/GauravAdz/linz-cipher).
