import { Folder, Server, Wrench, BookOpen } from "lucide-react"

export function Backpack() {
  return (
    <div className="bg-emerald-100 rounded-3xl p-5 h-full min-h-[200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">BACKPACK</h2>
        <div className="w-8 h-8 rounded-lg bg-green-700 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Icons Grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Files */}
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-400 flex items-center justify-center mb-2 shadow-md">
            <Folder className="w-7 h-7 text-gray-800" />
          </div>
          <span className="text-xs font-semibold text-gray-700">FILES</span>
        </div>

        {/* Memory */}
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-purple-600 flex items-center justify-center mb-2 shadow-md">
            <Server className="w-7 h-7 text-white" />
          </div>
          <span className="text-xs font-semibold text-gray-700">MEMORY</span>
        </div>

        {/* Tools */}
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center mb-2 shadow-md">
            <Wrench className="w-7 h-7 text-white" />
          </div>
          <span className="text-xs font-semibold text-gray-700">TOOLS</span>
        </div>
      </div>
    </div>
  )
}
