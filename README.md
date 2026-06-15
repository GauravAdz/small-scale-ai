# GauravGPT 🤖

GauravGPT is a lightweight, responsive, browser-based AI chatbot interface powered by [Puter.js](https://puter.com). It features a custom AI persona ("Gaurav Adhikari") and is built entirely with plain HTML, CSS, and Vanilla JavaScript. No build steps or complex server setups are required.

## ✨ Features

* **Context-Aware AI:** Maintains conversation history so the AI remembers previous messages in the chat.
* **Custom Persona:** Driven by a customizable system prompt to act as an empathetic, intelligent, and helpful individual.
* **Responsive Design:** Fully optimized for both desktop and mobile, utilizing `100dvh` to perfectly handle mobile virtual keyboards.
* **Light/Dark Mode:** Automatically adapts to the user's system preferences using CSS media queries (`prefers-color-scheme`).
* **Modern UI/UX:** * Animated typing indicators.
  * Real-time message timestamps.
  * Auto-resizing input textarea (max 120px height with scroll fallback).
  * `Enter` to send, `Shift + Enter` for a new line.

## 🛠️ Technologies Used

* **HTML5 / CSS3** (Custom variables, Flexbox, CSS animations)
* **Vanilla JavaScript** (ES6+)
* **[Puter.js API](https://js.puter.com/v2/)** (`puter.ai.chat` for AI interactions)

## 🚀 How to Run

Because this project relies entirely on client-side code and Puter.js, running it is incredibly simple:

1. Clone or download this repository.
2. Open the `index.html` file directly in any modern web browser.
3. Start chatting!

## ⚙️ Customization

If you want to modify the AI's personality, you can easily change the `SYSTEM_PROMPT` variable located in the `<script>` tag of the `index.html` file:

```javascript
const SYSTEM_PROMPT = `
You are [Your Name], a curious and tech-savvy individual...
[Add your custom background, tone, and instructions here]
`;
