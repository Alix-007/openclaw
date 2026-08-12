package ai.openclaw.app

import ai.openclaw.app.gateway.GatewayMethod
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class GatewayChatMessageCapabilityTest {
  @Test
  fun chatMessageGetCapabilityFailsClosedAcrossOldDisconnectAndReconnectMethodSets() {
    val app = RuntimeEnvironment.getApplication()
    val securePrefs =
      app.getSharedPreferences(
        "openclaw.node.chat-message-capability.test.${UUID.randomUUID()}",
        android.content.Context.MODE_PRIVATE,
      )
    val runtime = NodeRuntime(app, SecurePrefs(app, securePrefsOverride = securePrefs))
    val capability = runtime.chatMessageGetAvailable
    val scopeRevision = runtime.chatMessageGetScopeRevision

    assertFalse(capability.value)
    assertTrue(scopeRevision.value == 0L)
    replaceMethods(runtime, setOf("chat.history"))
    assertFalse(capability.value)
    assertTrue(scopeRevision.value == 1L)
    replaceMethods(runtime, setOf(GatewayMethod.ChatMessageGet.rawValue))
    assertTrue(capability.value)
    assertTrue(scopeRevision.value == 2L)
    clearOperatorGatewayState(runtime)
    assertFalse(capability.value)
    assertTrue(scopeRevision.value == 3L)
    replaceMethods(runtime, setOf(GatewayMethod.ChatMessageGet.rawValue))
    assertTrue(capability.value)
    assertTrue(scopeRevision.value == 4L)
  }

  private fun replaceMethods(
    runtime: NodeRuntime,
    methods: Set<String>,
  ) {
    runtime.javaClass
      .getDeclaredMethod("replaceGatewayMethods", Set::class.java)
      .apply { isAccessible = true }
      .invoke(runtime, methods)
  }

  private fun clearOperatorGatewayState(runtime: NodeRuntime) {
    runtime.javaClass
      .getDeclaredMethod("clearOperatorGatewayState", java.lang.Boolean.TYPE)
      .apply { isAccessible = true }
      .invoke(runtime, false)
  }
}
