using System.IO;
using System.Linq;
using UnityEngine;
using TMPro;
using UnityEngine.UI;
using System.Collections.Generic;
using UnityEngine.SceneManagement;
using System;
using System.Collections;
using SimpleJSON;

public class LoginHandler : MonoBehaviour
{
    public TMP_Dropdown userDropdown;
    public TMP_InputField[] configInputs; // ML, AP, MLAP — assign in inspector
    public Button saveButton, editButton, refreshButton;
    public TextMeshProUGUI statusMessage; // shown for new users

    // Optional: assign a panel in the inspector that wraps configInputs + editButton.
    // If left null, individual GameObjects are toggled instead.
    public GameObject configPanel;

    private string configFileName = "configdata.csv";
    private string baseDataPath;
    private string currentUserPath;
    private string[] headers;
    private string[] originalValues;
    private string hospitalID;
    private bool isNewUser = false;

    // patient_id → JSONNode for side/limb lookup
    private Dictionary<string, JSONNode> patientDataMap = new Dictionary<string, JSONNode>();

    private static readonly string patientsJsonPath = @"C:\NeuroDash\patients.json";

    void Start()
    {
        baseDataPath = Path.Combine(Application.dataPath, "data");
        if (!Directory.Exists(baseDataPath))
            Directory.CreateDirectory(baseDataPath);

        userDropdown.onValueChanged.AddListener(OnUserSelected);
        saveButton.onClick.AddListener(OnLoginClicked);
        editButton.onClick.AddListener(EnableEditing);
        refreshButton.onClick.AddListener(OnRefreshClicked);

        foreach (var input in configInputs)
            input.interactable = false;

        neurodash.start();
        LoadPatientIDs();

        if (userDropdown.options.Count > 0)
            OnUserSelected(userDropdown.value);
    }

    void OnRefreshClicked()
    {
        if (!neurodash.start()) return; // already running, ignore extra clicks
        refreshButton.interactable = false;
        StartCoroutine(WaitForSyncThenReload());
    }

    IEnumerator WaitForSyncThenReload()
    {
        while (neurodash.isRunning)
            yield return new WaitForSeconds(0.5f);

        string previousID = hospitalID;
        LoadPatientIDs();

        int idx = userDropdown.options.FindIndex(o => o.text == previousID);
        if (idx >= 0)
            userDropdown.value = idx;
        else if (userDropdown.options.Count > 0)
            OnUserSelected(0);

        refreshButton.interactable = true;
    }

    // ── Load IDs from patients.json ──────────────────────────────

    void LoadPatientIDs()
    {
        if (!File.Exists(patientsJsonPath))
        {
            Debug.LogError($"patients.json not found at {patientsJsonPath}. Falling back to local folders.");
            LoadUserFoldersFallback();
            return;
        }

        var json = JSON.Parse(File.ReadAllText(patientsJsonPath));
        patientDataMap.Clear();

        List<string> ids = new List<string>();
        foreach (JSONNode patient in json["patients"])
        {
            if (patient["status"].Value.ToLower() != "active") continue;

            bool hasMars = false;
            foreach (JSONNode device in patient["devices"])
            {
                if (device.Value.ToUpper() == "MARS") { hasMars = true; break; }
            }
            if (!hasMars) continue;

            string uid = patient["user_id"].Value;
            ids.Add(uid);
            patientDataMap[uid] = patient;
        }

        if (ids.Count == 0)
            Debug.LogWarning("No active MARS patients found in patients.json.");

        userDropdown.ClearOptions();
        userDropdown.AddOptions(ids);
    }

    void LoadUserFoldersFallback()
    {
        if (!Directory.Exists(baseDataPath)) return;
        var folders = Directory.GetDirectories(baseDataPath).Select(Path.GetFileName).ToList();
        userDropdown.ClearOptions();
        if (folders.Count > 0) userDropdown.AddOptions(folders);
    }

    // ── Dropdown selection ───────────────────────────────────────

    void OnUserSelected(int index)
    {
        if (userDropdown.options.Count == 0) return;

        hospitalID = userDropdown.options[index].text;
        currentUserPath = Path.Combine(baseDataPath, hospitalID, "data");
        string csvPath = Path.Combine(currentUserPath, configFileName);

        if (!File.Exists(csvPath))
        {
            isNewUser = true;
            originalValues = null;
            ShowNewUserUI();
            return;
        }

        isNewUser = false;
        ShowExistingUserUI();
        LoadConfigFromCSV(csvPath);
    }

    void ShowNewUserUI()
    {
        if (statusMessage != null)
        {
            statusMessage.gameObject.SetActive(true);
            statusMessage.text = "New user — account will be created on Login.";
        }

        if (configPanel != null)
            configPanel.SetActive(false);
        else
        {
            foreach (var input in configInputs) input.gameObject.SetActive(false);
            editButton.gameObject.SetActive(false);
        }

        saveButton.gameObject.SetActive(true);
    }

    void ShowExistingUserUI()
    {
        if (statusMessage != null) statusMessage.gameObject.SetActive(false);

        if (configPanel != null)
            configPanel.SetActive(true);
        else
        {
            foreach (var input in configInputs) input.gameObject.SetActive(true);
            editButton.gameObject.SetActive(true);
        }

        saveButton.gameObject.SetActive(true);

        foreach (var input in configInputs)
            input.interactable = false;
    }

    void LoadConfigFromCSV(string csvPath)
    {
        string[] requiredFields = new string[] { "ML", "AP", "MLAP" };
        string[] lines = File.ReadAllLines(csvPath);
        if (lines.Length < 2) return;

        headers = lines[0].Split(',');
        originalValues = lines[lines.Length - 1].Split(',');

        Dictionary<string, string> fieldMap = new Dictionary<string, string>();
        for (int i = 0; i < headers.Length; i++)
        {
            if (requiredFields.Contains(headers[i]))
                fieldMap[headers[i]] = i < originalValues.Length ? originalValues[i] : "";
        }

        for (int i = 0; i < configInputs.Length; i++)
        {
            string key = requiredFields[i];
            configInputs[i].text = fieldMap.ContainsKey(key) ? fieldMap[key] : "";
        }
    }

    // ── Login button ─────────────────────────────────────────────

    void OnLoginClicked()
    {
        StartCoroutine(LoginSequence());
    }

    IEnumerator LoginSequence()
    {
        saveButton.interactable = false;

        int agentCode = -1;
        string agentMsg = "";

        yield return StartCoroutine(AgentSession.Instance.CallStart(hospitalID,
            (code, msg) => { agentCode = code; agentMsg = msg; }));

        Debug.Log($"[Login] agent answered {agentCode} for '{hospitalID}': {agentMsg}");

        if (agentCode == 409)
        {
            // Another device is training this patient: stay on the login scene, show one short message, load nothing.
            if (statusMessage != null)
            {
                statusMessage.gameObject.SetActive(true);
                statusMessage.text = "User is using another device";
            }
            else
                Debug.LogWarning("User is using another device (assign statusMessage in the inspector to show it).");

            saveButton.interactable = true; // they can pick another user, or press Login again later
            yield break;                    // nothing below runs: no config is written, no user is set, no scene is loaded
        }

        // 200 or -1 (agent not running) → proceed
        if (isNewUser) CreateConfigFromPatientsJson();
        else SaveChangesIfAny();

        AppData.Instance.setUser(hospitalID);
        SceneManager.LoadSceneAsync("MAIN");
    }

    void CreateConfigFromPatientsJson()
    {
        DateTime startDate = DateTime.Now;
        DateTime endDate = startDate.AddDays(28).Date.AddDays(1).AddSeconds(-1);

        string trainingSide = "Right";
        if (patientDataMap.TryGetValue(hospitalID, out JSONNode patient))
        {
            string side = patient["side"]?.Value;
            if (!string.IsNullOrEmpty(side))
                trainingSide = char.ToUpper(side[0]) + side.Substring(1).ToLower();
        }

        string location   = "ranipet";
        string group      = "Experimental";
        string ML         = "0";
        string AP         = "0";
        string MLAP       = "0";
        string upperArm   = "250";
        string foreArm    = "150";
        string totalTime  = "0";

        string csvHeaders = "HomerID,StartDate,EndDate,TotalTime,ML,AP,MLAP,ForeArmLength,UpperArmLength,TrainingSide,Location,Group";
        // Order matches oneTimeConfig.saveConfig() exactly
        string data = $"{hospitalID},{startDate:dd-MM-yyyy HH:mm:ss},{endDate:dd-MM-yyyy HH:mm:ss},{totalTime},{ML},{AP},{MLAP},{upperArm},{foreArm},{trainingSide},{location},{group}";

        string dirPath  = Path.Combine(Application.dataPath, "data", hospitalID, "data");
        string csvPath  = Path.Combine(dirPath, configFileName);

        if (!Directory.Exists(dirPath)) Directory.CreateDirectory(dirPath);
        if (!File.Exists(csvPath)) File.WriteAllText(csvPath, csvHeaders + Environment.NewLine);
        File.AppendAllText(csvPath, data + Environment.NewLine);

        Debug.Log($"Auto-created config for new user '{hospitalID}' (side: {trainingSide}).");
    }

    void SaveChangesIfAny()
    {
        if (originalValues == null) return;

        string[] updatedValues = (string[])originalValues.Clone();
        bool anyChanges = false;
        string[] editableFields = new string[] { "ML", "AP", "MLAP" };

        for (int i = 0; i < editableFields.Length; i++)
        {
            int fi = Array.IndexOf(headers, editableFields[i]);
            if (fi >= 0 && fi < updatedValues.Length && updatedValues[fi] != configInputs[i].text)
            {
                updatedValues[fi] = configInputs[i].text;
                anyChanges = true;
            }
        }

        if (anyChanges)
        {
            string csvPath = Path.Combine(currentUserPath, configFileName);
            File.AppendAllText(csvPath, string.Join(",", updatedValues) + Environment.NewLine);
        }
    }

    public void EnableEditing()
    {
        foreach (var input in configInputs)
            input.interactable = true;
    }
}
