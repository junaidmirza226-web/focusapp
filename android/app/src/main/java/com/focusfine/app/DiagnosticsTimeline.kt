package com.focusfine.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.Date

/**
 * Lightweight in-memory diagnostics timeline used for support bundles.
 * Keeps recent lifecycle/enforcement events without writing private data to disk.
 */
object DiagnosticsTimeline {
    private const val MAX_ENTRIES = 180

    private data class Entry(
        val atMs: Long,
        val source: String,
        val event: String,
        val details: String?
    )

    private val lock = Any()
    private val entries = ArrayDeque<Entry>()

    fun record(source: String, event: String, details: String? = null) {
        val sanitizedDetails = details
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.take(280)
        val entry = Entry(
            atMs = System.currentTimeMillis(),
            source = source.take(48),
            event = event.take(120),
            details = sanitizedDetails
        )
        synchronized(lock) {
            entries.addLast(entry)
            while (entries.size > MAX_ENTRIES) {
                entries.removeFirst()
            }
        }
    }

    fun snapshot(limit: Int = 40): JSONArray {
        val safeLimit = limit.coerceIn(1, MAX_ENTRIES)
        val rows = synchronized(lock) {
            entries.takeLast(safeLimit).toList().asReversed()
        }
        return JSONArray().apply {
            rows.forEach { row ->
                put(
                    JSONObject().apply {
                        put("atMs", row.atMs)
                        put("atReadable", Date(row.atMs).toString())
                        put("source", row.source)
                        put("event", row.event)
                        put("details", row.details ?: JSONObject.NULL)
                    }
                )
            }
        }
    }
}
