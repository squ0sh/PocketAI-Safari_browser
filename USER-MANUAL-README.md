# Pocket AI user manual

Pocket AI lets you chat with an AI on your device. Start with a small model, then try larger ones if your device can run them. This guide is also available through **Help & user guide** inside the app, including offline once app setup finishes.

## Contents

- [Your first conversation](#your-first-conversation)
- [Choose a model](#choose-a-model)
- [Prepare for offline use](#prepare-for-offline-use)
- [Reopen your saved model](#reopen-your-saved-model)
- [Ask about text](#ask-about-text)
- [Manage conversations](#manage-conversations)
- [Improve or stop an answer](#improve-or-stop-an-answer)
- [Try the speed test](#try-the-speed-test)
- [Privacy and online mode](#privacy-and-online-mode)
- [Update the app](#update-the-app)
- [Troubleshooting](#troubleshooting)

## Your first conversation

1. Open Pocket AI in Safari while connected to the internet.
2. Leave the default **Bonsai 1.7B** selected, or choose it using the model button at the top.
3. Tap **Load Local AI**. Wait for the model to finish loading. The first load downloads model data and can take time.
4. Type a question, such as “Explain how rain forms in simple terms,” then tap the send arrow.
5. Use **Stop** if you want to interrupt the answer.

No model starts downloading just because you open the app or choose it from the menu. Loading from the internet does not save a reusable GGUF model file. Follow the offline steps below to keep a copy in Files.

## Choose a model

The model button at the top opens the model menu. Choose a model, then load it. Switching away from a loaded model reloads the app; save or send any unfinished draft first.

- **Bonsai 1.7B:** the suggested starting point for local file use on iPhone.
- **Bonsai 4B:** a larger option if your device has enough available memory.
- **Bonsai 8B:** experimental on phones; it uses considerably more memory.
- **Bonsai 27B:** a local experiment requiring about 3.8 GB for weights plus working memory. It may not load on your phone.
- **Qwen 0.5B:** a small alternative with a different model-loading system. The GGUF file instructions in this guide apply to Bonsai.
- **Online Assist:** uses the configured online service and requires internet.

Larger models are not always the best choice. Available memory, other apps, temperature and browser support affect results. The app's model guidance uses successful loads and replies observed on your browser; it is not a guarantee.

## Prepare for offline use

Open **Offline setup** and follow these three steps:

1. **Save app support files.** Keep the app open online until it says **App ready for offline GGUF**. This saves the interface, guide and model support files. On iPhone, you can add Pocket AI to your Home Screen through Safari's Share menu.
2. **Save a model in Files.** Open the model menu and use the matching **Save to Files** link. Start with Bonsai 1.7B. Make sure the download is actually on your iPhone rather than only stored in iCloud. The app cannot inspect Files until you choose a file.
3. **Try it in airplane mode.** Reopen Pocket AI, choose **Load from a file…** in the model menu, select your saved GGUF and send a short question.

The app-ready message refers to support files, not your model download. Only use the listed Bonsai Q1_0 GGUF models; arbitrary GGUF files are not supported. Keep the original recognizable Bonsai filename.

## Reopen your saved model

Choose **Load from a file…** and select the saved model each time you reopen the app. Your conversations stay saved, but the browser cannot keep access to the file across sessions.

Safari may remove website storage when space is tight. Keep your model in Files and check offline setup before travelling. If support files are missing, reconnect and use **Offline setup → Repair offline setup**.

## Ask about text

**Ask about text** lets you give the AI an article, note or other text to discuss. It does not automatically read the Safari tab you were viewing.

1. Copy the useful text from an article or document.
2. Open **Ask about text**, give it an optional title, and paste into **Text to discuss**. Alternatively, open a saved text, Markdown or HTML file.
3. Tap **Start a new chat with this text**. This creates a separate conversation and keeps the attachment with it.
4. Choose **Summarize**, **Explain simply**, or **List key points**, or type your own question. Suggestions only fill the message box. Tap Send when ready; load a model first if needed.

For example, paste an article about rain, title it “How rain forms,” and start a new chat. Tap **Explain simply** and Send. Then ask “What does condensation mean in this article?”

Use **View attached text** above the conversation to read your reference again. Editing the text and starting another chat creates a new conversation; it does not change the existing attachment.

Pasted text can contain up to 100,000 characters. Saved files must be no larger than 2 MB. PDF and image import are not supported; copy readable text and paste it instead. A model may only receive the beginning of a long attachment because its reading space is limited. The app tells you when it uses an excerpt; paste the section you need when asking about material near the end.

The optional **Fetch a website online** section contacts the website directly and requires an HTTPS URL. Some websites block browser access or need a login. If fetching fails, copy and paste the text from Safari instead. Fetching text does not send a question to an AI service.

## Manage conversations

Open the history menu at the top left to find previous conversations. Search by title or words in a message. **New Chat** starts a fresh conversation.

Each history entry has export and delete buttons. Export saves a Markdown transcript, including any attached reference. Deleting removes that conversation from this device. Export anything you want to keep before clearing browser website data.

## Improve or stop an answer

- **Stop:** interrupts generation and keeps any partial answer.
- **Retry:** replaces the answer to the same question.
- **Edit & resend:** lets you change a question. Sending the edit replaces its answer and later messages. Use **Cancel edit** to keep the original conversation.
- **Continue:** appears when a local answer reaches its length limit and can continue with the currently loaded model.

AI answers can contain mistakes. Check important details against the original source. If a question is too long, shorten it or split it into smaller questions.

## Try the speed test

Load a local model, open **Speed test**, and tap **Run benchmark**. It runs one warm-up and three measured replies. Results stay on this device.

A shorter time to first visible text means the answer starts sooner. A higher whole-reply token rate means faster output on that test. These results measure speed, not answer quality. Model load times come from actual loads, not from repeating the question.

To interrupt, close the panel and tap Stop. An interrupted benchmark does not save a completed result. **Clear results** removes speed measurements and model-fit observations.

## Privacy and online mode

With a local model, your chat and attached text stay on this device. Local models work without internet once the app support files and a compatible model are available locally.

When you explicitly select an online model and send a question, the app sends the relevant conversation and attached text to the configured AI service. Look at the mode label before sending private material. Loading a local model from the internet and fetching a website still contact their respective download sources.

**27B online options** offers a separate choice when local 27B is impractical. Checking availability contacts the app's server without sending chat text. Switching requires your confirmation; only Send submits a question. This option is unavailable unless a specific Bonsai 27B route has been configured. It cannot work offline.

## Update the app

Connect to the internet, open the history menu, and tap **Update site**. Keep the app open while support files download. The app switches to the completed update and preserves your saved chats.

If setup still needs attention, open **Offline setup → Repair offline setup**. Do not clear website storage as a first repair step: it can remove chats and offline files.

## Troubleshooting

### Offline setup is incomplete

Reconnect, keep the app open and tap **Repair offline setup**. Large support files may take a few minutes. If it fails, read **Technical details** for the missing file or error and try again with a stable connection. The user guide itself becomes available offline after app installation completes.

### My model is missing or will not load

Check that the GGUF has finished downloading onto your device in Files. Reselect it using **Load from a file…**. Check that it is one of the supported Bonsai Q1_0 files. If the browser runs out of memory, try a smaller model and close other demanding apps. Expand **Technical details** for the original error.

### The app asks me to load the model again

This is expected after restarting the app. It can also happen if the browser releases GPU memory while backgrounded. Your conversation remains saved; reselect and load the model to continue.

### A website will not import

Some sites block direct fetching or render text only after scripts run. Open the website in Safari, copy the text you need, and paste it into **Ask about text**.

### The AI misses part of my article

The full reference may be longer than the model can read at once. Paste a shorter excerpt that contains the information you want to discuss, then ask a specific question.

### Online Assist or 27B online is unavailable

Check your connection. The service also needs working server configuration. You can select and load a supported local model to continue offline.
