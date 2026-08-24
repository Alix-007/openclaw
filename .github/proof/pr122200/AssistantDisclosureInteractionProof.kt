package ai.openclaw.app.ui.chat

import ai.openclaw.app.BuildConfig
import ai.openclaw.app.MainActivity
import ai.openclaw.app.chat.ChatFullMessageLoadResult
import ai.openclaw.app.chat.ChatMessage
import ai.openclaw.app.chat.ChatMessageContent
import ai.openclaw.app.ui.OpenClawTheme
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
  fun emulatorShowsExpandedFlowAndUnavailableStates() {
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

    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      scenario.onActivity { activity ->
        activity.setContent {
          OpenClawTheme {
            val proofState = proofStateDescription(disclosureState)
            Box(
              modifier =
                Modifier
                  .fillMaxSize()
                  .padding(18.dp)
                  .semantics { contentDescription = proofState },
            ) {
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
      waitForDescription(device, "proof-state-preview")
      capture(device, artifactDir, "01-preview")

      clickText(device, "View all")
      waitForText(device, "Close")
      waitForDescription(device, "proof-state-full")
      capture(device, artifactDir, "02-full")

      clickText(device, "Close")
      waitForText(device, "View all")
      waitForDescription(device, "proof-state-closed")
      capture(device, artifactDir, "03-closed")

      scenario.onActivity {
        failuresRemaining = 1
        disclosureState = null
      }
      instrumentation.waitForIdleSync()
      clickText(device, "View all")
      waitForText(device, "Retry")
      waitForDescription(device, "proof-state-retry")
      capture(device, artifactDir, "04-retry")

      clickText(device, "Retry")
      waitForText(device, "Close")
      waitForDescription(device, "proof-state-full")
      capture(device, artifactDir, "05-recovered")

      scenario.onActivity {
        disclosureState =
          AssistantMessageDisclosureState.Unavailable(
            ChatFullMessageLoadResult.UnavailableReason.NotFound,
          )
      }
      instrumentation.waitForIdleSync()
      waitForDescription(device, "proof-state-not-found")
      assertDisclosureActionMissing(device)
      capture(device, artifactDir, "06-not-found")

      scenario.onActivity {
        disclosureState =
          AssistantMessageDisclosureState.Unavailable(
            ChatFullMessageLoadResult.UnavailableReason.Oversized,
          )
      }
      instrumentation.waitForIdleSync()
      waitForDescription(device, "proof-state-oversized")
      assertDisclosureActionMissing(device)
      capture(device, artifactDir, "07-oversized")

      scenario.onActivity {
        disclosureState =
          AssistantMessageDisclosureState.Unavailable(
            ChatFullMessageLoadResult.UnavailableReason.NotVisible,
          )
      }
      instrumentation.waitForIdleSync()
      waitForDescription(device, "proof-state-not-visible")
      assertDisclosureActionMissing(device)
      capture(device, artifactDir, "08-not-visible")
    }
  }

  private fun assertDisclosureActionMissing(device: UiDevice) {
    for (label in listOf("Retry", "View all", "Close")) {
      assertTrue(
        "Unexpected disclosure action: $label",
        device.wait(Until.gone(By.text(label)), uiTimeoutMs),
      )
    }
  }

  private fun waitForText(
    device: UiDevice,
    text: String,
  ): UiObject2 =
    checkNotNull(device.wait(Until.findObject(By.text(text)), uiTimeoutMs)) {
      "Missing visible text: $text"
    }

  private fun waitForDescription(
    device: UiDevice,
    description: String,
  ): UiObject2 =
    checkNotNull(device.wait(Until.findObject(By.desc(description)), uiTimeoutMs)) {
      "Missing proof state: $description"
    }

  private fun proofStateDescription(state: AssistantMessageDisclosureState?): String =
    when (state) {
      null -> "proof-state-preview"
      AssistantMessageDisclosureState.Loading -> "proof-state-loading"
      AssistantMessageDisclosureState.Error -> "proof-state-retry"
      is AssistantMessageDisclosureState.Loaded ->
        if (state.expanded) "proof-state-full" else "proof-state-closed"
      is AssistantMessageDisclosureState.Unavailable ->
        when (state.reason) {
          ChatFullMessageLoadResult.UnavailableReason.NotFound -> "proof-state-not-found"
          ChatFullMessageLoadResult.UnavailableReason.Oversized -> "proof-state-oversized"
          ChatFullMessageLoadResult.UnavailableReason.NotVisible -> "proof-state-not-visible"
        }
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
    const val proofProductSha = "937412ce4d1728cf5efbb1865107aec8b4ea9925"
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
