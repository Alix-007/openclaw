package ai.openclaw.app.ui.chat

import ai.openclaw.app.BuildConfig
import ai.openclaw.app.chat.ChatMessage
import ai.openclaw.app.chat.ChatMessageContent
import ai.openclaw.app.ui.OpenClawTheme
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class AssistantDisclosureInteractionProof {
  @Test
  fun emulatorShowsExpandCollapseAndRetryRecovery() {
    assertEquals(proofProductSha, BuildConfig.GIT_COMMIT)
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val device = UiDevice.getInstance(instrumentation)
    val artifactDir =
      File(checkNotNull(instrumentation.targetContext.getExternalFilesDir(null)), "pr122200-proof")
        .apply {
          deleteRecursively()
          assertTrue(mkdirs())
        }
    var disclosureState by mutableStateOf<AssistantMessageDisclosureState?>(null)
    var failuresRemaining = 0

    ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
      scenario.onActivity { activity ->
        activity.setContent {
          OpenClawTheme {
            Box(modifier = Modifier.fillMaxSize().padding(18.dp)) {
              ChatBubble(
                messageId = proofMessageId,
                entryId = proofMessageId,
                role = "assistant",
                live = false,
                content = listOf(ChatMessageContent(text = previewText)),
                timestampMs = null,
                onReplyMessage = {},
                sessionActionsEnabled = false,
                onRewindMessage = {},
                onForkMessage = {},
                speechState = null,
                onToggleListen = { _, _ -> },
                inlineMediaPlaybackBlocked = false,
                inlineWidgetResolverReady = false,
                resolveInlineWidgetResource = { _, _ -> null },
                loadImageArtifact = { null },
                loadMediaArtifact = { _, _, _ -> null },
                isTruncated = true,
                assistantDisclosureState = disclosureState,
                onToggleAssistantDisclosure = {
                  disclosureState =
                    when (val current = disclosureState) {
                      is AssistantMessageDisclosureState.Loaded -> current.copy(expanded = !current.expanded)
                      else ->
                        if (failuresRemaining > 0) {
                          failuresRemaining -= 1
                          AssistantMessageDisclosureState.Error
                        } else {
                          AssistantMessageDisclosureState.Loaded(fullMessage, expanded = true)
                        }
                    }
                },
              )
            }
          }
        }
      }

      instrumentation.waitForIdleSync()
      waitForText(device, "View all")
      waitForTextContaining(device, previewText)
      capture(device, artifactDir, "01-preview")

      clickText(device, "View all")
      waitForText(device, "Close")
      waitForTextContaining(device, fullMarker)
      capture(device, artifactDir, "02-full")

      clickText(device, "Close")
      waitForText(device, "View all")
      waitForTextContaining(device, previewText)
      capture(device, artifactDir, "03-closed")

      scenario.onActivity {
        failuresRemaining = 1
        disclosureState = null
      }
      instrumentation.waitForIdleSync()
      clickText(device, "View all")
      waitForText(device, "Retry")
      capture(device, artifactDir, "04-retry")

      clickText(device, "Retry")
      waitForText(device, "Close")
      waitForTextContaining(device, fullMarker)
      capture(device, artifactDir, "05-recovered")
    }
  }

  private fun waitForText(
    device: UiDevice,
    text: String,
  ): UiObject2 =
    checkNotNull(device.wait(Until.findObject(By.text(text)), uiTimeoutMs)) {
      "Missing visible text: $text"
    }

  private fun waitForTextContaining(
    device: UiDevice,
    text: String,
  ): UiObject2 =
    checkNotNull(device.wait(Until.findObject(By.textContains(text)), uiTimeoutMs)) {
      "Missing visible text containing: $text"
    }

  private fun clickText(
    device: UiDevice,
    text: String,
  ) {
    val clickable =
      generateSequence(waitForText(device, text)) { it.parent }
        .firstOrNull { it.isClickable }
    checkNotNull(clickable) { "Visible text has no clickable owner: $text" }.click()
  }

  private fun capture(
    device: UiDevice,
    artifactDir: File,
    name: String,
  ) {
    device.waitForIdle()
    assertTrue(device.takeScreenshot(File(artifactDir, "$name.png")))
    val hierarchy = File(artifactDir, "$name.xml")
    device.dumpWindowHierarchy(hierarchy)
    assertTrue(hierarchy.isFile && hierarchy.length() > 0)
  }

  private companion object {
    const val proofProductSha = "7b2dbbf4287b9cfebe58c1b0ffa02bacac092d75"
    const val proofMessageId = "proof-message"
    const val previewText = "Preview: release blockers remain. ...(truncated)..."
    const val fullMarker = "Complete: localization and review follow-ups are resolved."
    const val uiTimeoutMs = 10_000L
    val fullMessage =
      ChatMessage(
        id = proofMessageId,
        role = "assistant",
        content = listOf(ChatMessageContent(text = fullMarker)),
        timestampMs = null,
        entryId = proofMessageId,
      )
  }
}
