// Import the web socket library
const WebSocket = require("ws");
// Load the .env file into memory so the code has access to the key
const dotenv = require("dotenv");
dotenv.config();
const Speaker = require("speaker");
const record = require("node-record-lpcm16");
// Function to start recording audio
function startRecording() {
  return new Promise((resolve, reject) => {
    console.log("Speak to send a message to the assistant. Press Enter when done.");
    // Create a buffer to hold the audio data
    const audioData = [];
    // Start recording in PCM16 format
    const recordingStream = record.record({
      sampleRate: 16000, // 16kHz sample rate (standard for speech recognition)
      threshold: 0, // Start recording immediately
      verbose: false,
      recordProgram: "sox", // Specify the program
    });
    // Capture audio data
    recordingStream.stream().on("data", (chunk) => {
      audioData.push(chunk); // Store the audio chunks
    });
    // Handle errors in the recording stream
    recordingStream.stream().on("error", (err) => {
      console.error("Error in recording stream:", err);
      reject(err);
    });
    // Set up standard input to listen for the Enter key press
    process.stdin.resume(); // Start listening to stdin
    process.stdin.on("data", () => {
      console.log("Recording stopped.");
      recordingStream.stop(); // Correctly stop the recording stream
      process.stdin.pause(); // Stop listening to stdin
      // Convert audio data to a single Buffer
      const audioBuffer = Buffer.concat(audioData);
      // Convert the Buffer to Base64
      const base64Audio = audioBuffer.toString("base64");
      resolve(base64Audio); // Resolve the promise with Base64 audio
    });
  });
}

const functions = {
    calculate_sum: (args) => args.a + args.b,
    set_memory: (args) => console.log(`Saving memory ${args}`)
}
const sumTool = {
    type: "function",
    name: "calculate_sum",
    description: "Use this function when asked to add numbers together, for example when asked 'What's 4 + 6'?.",
    parameters: {
        type: "object",
        properties: {
            "a": { "type": "number" },
            "b": { "type": "number" }
        },
        required: ["a", "b"]
    }
}

const setMemory = {
    type: "function",
    name: 'set_memory',
    description: 'Saves important data about the user into memory.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'The key of the memory value. Always use lowercase and underscores, no other characters.',
        },
        value: {
          type: 'string',
          description: 'Value can be anything represented as a string',
        },
      },
      required: ['key', 'value'],
    },
  }

// Add to the main() function after ws is initialized
const speaker = new Speaker({
    channels: 1, // Mono or Stereo
    bitDepth: 16, // PCM16 (16-bit audio)
    sampleRate: 24000, // Common sample rate (44.1kHz)
  });

function main() {
    // Connect to the API
    const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
    const ws = new WebSocket(url, {
        headers: {
            "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
            "OpenAI-Beta": "realtime=v1",
        },
    });
    
    // Add inside the main() function of index.js after creating ws
    async function handleOpen() {
        console.log("Connection is opened");
        // For text based conversations
        // const createConversationEvent = {
        //     type: "conversation.item.create",
        //     item: {
        //       type: "message",
        //       role: "user",
        //       content: [
        //         {
        //           type: "input_text",
        //           text: "Explain in one sentence what a web socket is"
        //         }
        //       ]
        //     }
        //   };

        // For audio based conversations input
        const base64AudioData = await startRecording();
        const createConversationEvent = {
            type: "conversation.item.create",
            item: {
            type: "message",
            role: "user",
            content: [
                {
                type: "input_audio",
                audio: base64AudioData,
                },
            ],
            },
        };
        ws.send(JSON.stringify(createConversationEvent));

        const createResponseEvent = {
            type: "response.create",
            response: {
                modalities: ["text", "audio"],
                instructions: "Please assist with the user's question and make friendly conversation with them. If they ask you a question first retrieve their stored memories before answering or asking them for more details. Also store anything memorable that they said about themselves like their likes or dislikes, their preferences or any interesting event that happened in their life'",
                tools: [sumTool, setMemory], // New for tool calling
                tool_choice: "auto", // New
            }
        }
        ws.send(JSON.stringify(createResponseEvent));
    }
    ws.on("open", handleOpen);

    async function handleMessage(messageStr) {
        const message = JSON.parse(messageStr);
        // Define what happens when a message is received
        console.log(`-- ${message.type} --`);

        switch(message.type) {
            case "response.text.delta":
                // We got a new text chunk, print it
                process.stdout.write(message.delta);
                break;
            case "response.audio.delta":
                // We got a new audio chunk
                const base64AudioChunk = message.delta;
                const audioBuffer = Buffer.from(base64AudioChunk, "base64");
                speaker.write(audioBuffer);
                break;
            case "response.function_call_arguments.done":
                console.log(`Using function ${message.name} with arguments ${message.arguments}`);
                // 1. Get the function information and call the function
                const function_name = message.name;
                const function_arguments = JSON.parse(message.arguments);
                const result = functions[function_name](function_arguments);
                console.log(`Got result ${result}`);

                // 2. Send the result of the function call
                const functionOutputEvent = {
                    type: "conversation.item.create",
                    item: {
                    type: "function_call_output",
                    role: "system",
                    output: `${result}`,
                    }
                };
                ws.send(JSON.stringify(functionOutputEvent));
                // 3. Request a response
                ws.send(JSON.stringify({type: "response.create"}));
                break;
            
            case "response.output_item.done":
                console.log(message);
                break;

            case "error":
                console.log(message);
                break;
            case "response.text.done":
                // The text is complete, print a new line
                process.stdout.write("\n");
                break;
            case "response.audio.done":
                // Response complete, close the socket
                speaker.end()
                ws.close();
                break;
        }
    }
    ws.on("message", handleMessage);
    
    async function handleClose() {
        console.log("Socket closed");
      }
    ws.on("close", handleClose);

    async function handleError(error) {
        console.log("Error", error);
      }
      ws.on("error", handleError);
}
main();