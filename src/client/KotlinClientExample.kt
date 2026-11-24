package com.fetchsystem.client

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Educational Kotlin Integration Example:
 * Connects an external Kotlin application (Desktop, CLI, or Android/Server)
 * to the Chromium External Fetch Engine via REST API.
 */
data class FetchRequest(
    val url: String,
    val headed: Boolean = true,
    val autoInteractMedia: Boolean = true,
    val timeout: Int = 30000
)

data class MediaStream(
    val type: String,
    val url: String
)

class ChromiumFetchClient(private val baseUrl: String = "http://localhost:3000") {

    private val httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    /**
     * Checks status of the Chromium Controller
     */
    fun checkStatus(): String {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/status"))
            .GET()
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        return response.body()
    }

    /**
     * Requests the Chromium instance to fetch a page and return intercepted media / structured data
     */
    fun fetchUrl(targetUrl: String, headed: Boolean = true): String {
        val jsonPayload = """
            {
                "url": "$targetUrl",
                "headed": $headed,
                "autoInteractMedia": true,
                "timeout": 35000
            }
        """.trimIndent()

        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/fetch"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
            .timeout(Duration.ofSeconds(45))
            .build()

        println("Sending fetch request to Chromium Engine for: $targetUrl")
        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

        if (response.statusCode() == 200) {
            println("✓ Fetch completed successfully!")
            return response.body()
        } else {
            throw RuntimeException("Fetch failed with status ${response.statusCode()}: ${response.body()}")
        }
    }

    /**
     * Resets cookies and persistent session state
     */
    fun clearSession(): Boolean {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/session/clear"))
            .POST(HttpRequest.BodyPublishers.noBody())
            .build()

        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        return response.statusCode() == 200
    }
}

fun main() {
    val client = ChromiumFetchClient()

    println("=== Checking Chromium Engine Status ===")
    println(client.checkStatus())

    val testUrl = "https://example.com"
    println("\n=== Fetching Target URL via Chromium Engine ===")
    val resultJson = client.fetchUrl(testUrl, headed = true)
    println("Response Preview:\n$resultJson")
}
