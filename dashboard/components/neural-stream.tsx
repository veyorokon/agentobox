"use client"

import { useState } from "react"
import { User, MoreHorizontal, ArrowUp, Copy, MessageSquare, Send } from "lucide-react"

export function NeuralStream() {
  const [message, setMessage] = useState("")

  const codeSnippet = `// module.kcret
class class Stop {
  return {
    const fuction eonIe&actor() {
      System.log("mtnchevo", "pause"::));
    }
  }
}`

  return (
    <div className="bg-violet-200 rounded-3xl p-5 h-full lg:min-h-[720px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">NEURAL STREAM</h2>
        <button className="p-2 hover:bg-violet-300 rounded-full transition-colors">
          <MoreHorizontal className="w-5 h-5 text-gray-700" />
        </button>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto">
        {/* First Message */}
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-gray-800" />
          </div>
          <div className="flex-1">
            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm">
              <p className="text-gray-800 text-sm">
                Hello, do you want to create UI/UX designer with parm alteversion! 😊
              </p>
            </div>
            <div className="mt-2">
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors">
                <MessageSquare className="w-4 h-4" />
                Chat
              </button>
            </div>
          </div>
        </div>

        {/* Code Block */}
        <div className="bg-gray-900 rounded-xl p-4 relative">
          <button className="absolute top-3 right-3 p-1.5 hover:bg-gray-700 rounded transition-colors">
            <Copy className="w-4 h-4 text-gray-400" />
          </button>
          <pre className="text-sm font-mono overflow-x-auto">
            <code>
              <span className="text-gray-500">// module.kcret</span>{"\n"}
              <span className="text-yellow-400">class</span>{" "}
              <span className="text-purple-400">class</span>{" "}
              <span className="text-green-400">Stop</span>{" "}
              <span className="text-white">{"{"}</span>{"\n"}
              {"  "}<span className="text-purple-400">return</span>{" "}
              <span className="text-white">{"{"}</span>{"\n"}
              {"    "}<span className="text-yellow-400">const</span>{" "}
              <span className="text-purple-400">fuction</span>{" "}
              <span className="text-blue-400">eonIe&actor</span>
              <span className="text-white">() {"{"}</span>{"\n"}
              {"      "}<span className="text-green-400">System</span>
              <span className="text-white">.</span>
              <span className="text-yellow-300">log</span>
              <span className="text-white">(</span>
              <span className="text-orange-300">"mtnchevo"</span>
              <span className="text-white">, </span>
              <span className="text-orange-300">"pause"</span>
              <span className="text-white">::));</span>{"\n"}
              {"    "}<span className="text-white">{"}"}</span>{"\n"}
              {"  "}<span className="text-white">{"}"}</span>{"\n"}
              <span className="text-white">{"}"}</span>
            </code>
          </pre>
        </div>

        {/* Second Message */}
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
            <User className="w-5 h-5 text-gray-800" />
          </div>
          <div className="flex-1">
            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm">
              <p className="text-gray-800 text-sm">
                Hey, there's a ronhinning you can character.∠ after∠nuse them to message you content of me. 😊
              </p>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors">
                <Send className="w-4 h-4" />
                Endout
              </button>
              <button className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                <ArrowUp className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Input Field */}
      <div className="mt-4 flex items-center gap-2 bg-white rounded-full px-4 py-2 border border-gray-200">
        <input
          type="text"
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm text-gray-700 placeholder-gray-400"
        />
        <button className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center hover:bg-amber-500 transition-colors">
          <ArrowUp className="w-4 h-4 text-gray-800" />
        </button>
      </div>
    </div>
  )
}
