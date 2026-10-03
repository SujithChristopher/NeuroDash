using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

public class AgentSession : MonoBehaviour
{
    private static AgentSession _instance;
    public static AgentSession Instance
    {
        get
        {
            if (_instance == null)
            {
                var go = new GameObject("[AgentSession]");
                _instance = go.AddComponent<AgentSession>();
                DontDestroyOnLoad(go);
            }
            return _instance;
        }
    }

    private const string BaseUrl = "http://127.0.0.1:5055";

    /// <summary>Set after a trial when the server gave the patient to another laptop: end the session when this is true.</summary>
    public bool SessionLost { get; private set; }

    void Awake()
    {
        if (_instance != null && _instance != this) { Destroy(gameObject); return; }
        _instance = this;
        DontDestroyOnLoad(gameObject);
        Application.quitting += OnQuitting;
    }

    void OnDestroy()
    {
        Application.quitting -= OnQuitting;
    }

    // ── /start ───────────────────────────────────────────────────
    // Called from LoginHandler. Yields until a response arrives.
    // onResult(statusCode, text): 200 = ok, 409 = conflict (text is the message to show), -1 = agent offline
    public IEnumerator CallStart(string patientId, System.Action<int, string> onResult)
    {
        string url = $"{BaseUrl}/start?patient={UnityWebRequest.EscapeURL(patientId)}";
        using (var req = UnityWebRequest.Get(url))
        {
            req.timeout = 5;
            yield return req.SendWebRequest();

            // A 409 arrives as result == ProtocolError, with responseCode 409: it must NOT be treated as "agent offline".
            if (req.result == UnityWebRequest.Result.ConnectionError ||
                req.result == UnityWebRequest.Result.DataProcessingError ||
                req.responseCode == 0)
            {
                Debug.LogWarning($"[AgentSession] /start {patientId}: agent not reachable ({req.error}); login is not restricted.");
                onResult(-1, ""); // agent not running — caller proceeds without restriction
                yield break;
            }

            string body = req.downloadHandler?.text ?? "";
            Debug.Log($"[AgentSession] /start {patientId} -> HTTP {(int)req.responseCode} {body}");

            // The agent answers with JSON; hand the caller the sentence to show, not the raw JSON.
            string message = body;
            var json = SimpleJSON.JSON.Parse(body);
            if (json != null && !string.IsNullOrEmpty(json["message"].Value)) message = json["message"].Value;

            onResult((int)req.responseCode, message);
        }
    }

    // ── /trial-ended ─────────────────────────────────────────────
    // Called from AppData.StopTrial() after each trial.
    // Fire-and-forget: if the reply has 'lost' set, stop the session.
    public void NotifyTrialEnded()
    {
        StartCoroutine(CallTrialEnded());
    }

    IEnumerator CallTrialEnded()
    {
        using (var req = UnityWebRequest.Get($"{BaseUrl}/trial-ended"))
        {
            req.timeout = 5;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success || req.responseCode != 200)
                yield break;

            var json = SimpleJSON.JSON.Parse(req.downloadHandler.text);
            if (json == null) yield break;

            // "lost" is null while the patient is still ours, and an object (who took the patient) when another laptop got them.
            // (AsBool is false for an object, so check IsObject.)
            var lostNode = json["lost"];
            if (lostNode.IsObject)
            {
                SessionLost = true;
                Debug.LogWarning($"[AgentSession] trial-ended: another laptop took the patient: {lostNode.ToString()}");
            }
        }
    }

    // ── /stop ────────────────────────────────────────────────────
    // Called from summarySceneHandler.exit() on session end / logout.
    public void StopSession()
    {
        StartCoroutine(CallStop());
    }

    IEnumerator CallStop()
    {
        using (var req = UnityWebRequest.Get($"{BaseUrl}/stop"))
        {
            req.timeout = 3;
            yield return req.SendWebRequest();
            SessionLost = false;
        }
    }

    // Synchronous best-effort /stop — coroutines don't run during shutdown
    void OnQuitting()
    {
        try
        {
            using (var client = new System.Net.WebClient())
                client.DownloadString($"{BaseUrl}/stop");
        }
        catch { /* best effort — app is closing */ }
    }
}
