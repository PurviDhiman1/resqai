import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap
} from "react-leaflet";
import L from "leaflet";
import axios from "axios";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://resqai-backend-x7x2.onrender.com";

const PHONE = {
  hospital: "102",
  police: "100",
  fire_station: "101",
  ambulance: "102",
  default: "112"
};

const STATIC_AI_GUIDANCE = {
  Fire: `Immediate Actions:
• Move everyone away from smoke and flames.
• Switch off electricity or gas only if safe.
• Stay low while exiting smoky areas.
• Call fire services immediately.

Do Not:
• Do not re-enter the building.
• Do not use water on electrical or oil fires.

Priority:
High

Responder Summary:
Fire risk detected. Prioritize evacuation, perimeter control, and fire response.`,

  Flood: `Immediate Actions:
• Move to higher ground immediately.
• Avoid walking or driving through flood water.
• Disconnect electricity if safe.
• Keep phone, flashlight, and drinking water ready.

Do Not:
• Do not touch wet electrical equipment.
• Do not enter fast-moving water.

Priority:
High

Responder Summary:
Flood risk detected. Prioritize safe evacuation and access route monitoring.`,

  Earthquake: `Immediate Actions:
• Drop, Cover, and Hold On.
• Stay away from glass and falling objects.
• After shaking stops, move to open space.
• Check for injuries and structural damage.

Do Not:
• Do not use elevators.
• Do not run during active shaking.

Priority:
Critical

Responder Summary:
Structural hazard possible. Prioritize injury check, evacuation, and aftershock safety.`,

  Landslide: `Immediate Actions:
• Move away from slopes and debris paths.
• Warn nearby people.
• Avoid blocked or unstable roads.
• Relocate to safer open ground.

Do Not:
• Do not stand near unstable slopes.
• Do not cross debris zones unless authorities confirm safety.

Priority:
High

Responder Summary:
Terrain instability suspected. Prioritize evacuation and route clearance.`,

  default: `Immediate Actions:
• Move to the safest reachable area.
• Call emergency services and share exact location.
• Help vulnerable people only if safe.
• Keep routes clear for responders.

Do Not:
• Do not crowd the hazard zone.
• Do not spread unverified information.

Priority:
Medium

Responder Summary:
Incident needs assessment, stabilization, and controlled response.`
};

function getDisasterColor(type) {
  if (type === "Fire") return "#ff4d4f";
  if (type === "Flood") return "#3db8ff";
  if (type === "Earthquake") return "#ff9f43";
  if (type === "Landslide") return "#2ecc71";
  return "#b084ff";
}

function getRiskColor(risk) {
  if (risk === "Critical Risk") return "#ff3b30";
  if (risk === "High Risk") return "#ff6b57";
  if (risk === "Medium Risk") return "#f5b942";
  return "#4cd964";
}

function getWorkflowColor(workflow) {
  if (workflow === "Resolved") return "#2ecc71";
  if (workflow === "Rescue Assigned") return "#ff4d4f";
  if (workflow === "Verified") return "#00d9ff";
  if (workflow === "AI Reviewed") return "#faad14";
  return "#a1a7b3";
}

function safeText(text, fallback = "Under review") {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  if (
    !raw ||
    lower.includes("quota") ||
    lower.includes("gemini") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("internal error") ||
    lower.includes("failed") ||
    lower.includes("nearest help data is being refreshed")
  ) {
    return fallback;
  }

  return raw;
}

function getSafePhone(place) {
  const raw = String(place?.phone || "").trim();
  const type = String(place?.type || "").toLowerCase();

  if (
    raw &&
    !raw.toLowerCase().includes("emergency local line") &&
    !raw.toLowerCase().includes("not available") &&
    !raw.toLowerCase().includes("not listed") &&
    raw !== "-"
  ) return raw;

  if (type.includes("hospital")) return PHONE.hospital;
  if (type.includes("police")) return PHONE.police;
  if (type.includes("fire")) return PHONE.fire_station;
  if (type.includes("ambulance")) return PHONE.ambulance;
  return PHONE.default;
}

function buildDirectionsUrl({ fromLat, fromLon, toLat, toLon, label }) {
  const bad = [fromLat, fromLon, toLat, toLon].some(
    value => value === null || value === undefined || Number.isNaN(Number(value))
  );

  if (bad) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || "Emergency Help Center")}`;
  }

  return `https://www.google.com/maps/dir/?api=1&origin=${Number(fromLat)},${Number(fromLon)}&destination=${Number(toLat)},${Number(toLon)}&travelmode=driving`;
}

function getCustomIcon(type) {
  const color = getDisasterColor(type);

  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;">
        <svg width="34" height="46" viewBox="0 0 24 24">
          <path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z"
            fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="12" cy="9" r="3" fill="white"/>
        </svg>
      </div>
    `,
    iconSize: [34, 46],
    iconAnchor: [17, 46],
    popupAnchor: [0, -40]
  });
}

function FitMapToReports({ reports }) {
  const map = useMap();

  useEffect(() => {
    if (!reports.length) return;

    if (reports.length === 1) {
      map.setView([reports[0].latitude, reports[0].longitude], 13);
      return;
    }

    const bounds = L.latLngBounds(reports.map(r => [r.latitude, r.longitude]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [reports, map]);

  return null;
}

export default function App() {
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const [reports, setReports] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [validation, setValidation] = useState(null);

  const [locationSuggestions, setLocationSuggestions] = useState([]);

  const [showAI, setShowAI] = useState(false);
  const [aiResponse, setAIResponse] = useState("");
  const [aiLoading, setAILoading] = useState(false);
  const [aiUsedFallback, setAIUsedFallback] = useState(false);

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpCenters, setHelpCenters] = useState([]);
  const [bestHelpCenter, setBestHelpCenter] = useState(null);
  const [incidentForHelpRoute, setIncidentForHelpRoute] = useState(null);

  const [previewImage, setPreviewImage] = useState("");
  const [previewReportName, setPreviewReportName] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingReportId, setEditingReportId] = useState(null);
  const [workflowNote, setWorkflowNote] = useState("");

  const [dashboardSearch, setDashboardSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [disasterFilter, setDisasterFilter] = useState("All");
  const [workflowFilter, setWorkflowFilter] = useState("All");
  const [verificationFilter, setVerificationFilter] = useState("All");
  const [sortBy, setSortBy] = useState("risk-desc");

  const [formData, setFormData] = useState({
    name: "",
    disasterType: "",
    location: "",
    description: "",
    image: null
  });

  const [editData, setEditData] = useState({
    disasterType: "",
    location: "",
    description: ""
  });

  const priorityOrder = {
    "Critical Risk": 1,
    "High Risk": 2,
    "Medium Risk": 3,
    "Low Risk": 4
  };

  const isLocalhost = API_BASE.includes("localhost") || API_BASE.includes("127.0.0.1");

  const sortedReports = useMemo(() => {
    return [...reports].sort((a, b) =>
      (priorityOrder[a.aiPredictedType] || 5) - (priorityOrder[b.aiPredictedType] || 5) ||
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  }, [reports]);

  const latestReport = sortedReports[0];

  const validReports = useMemo(() => {
    return sortedReports.filter(r =>
      r.latitude !== null &&
      r.longitude !== null &&
      r.latitude !== undefined &&
      r.longitude !== undefined &&
      !Number.isNaN(Number(r.latitude)) &&
      !Number.isNaN(Number(r.longitude))
    );
  }, [sortedReports]);

  const fetchReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/all-reports`);
      const data = await res.json();
      const finalData = Array.isArray(data) ? data : [];
      setReports(finalData);
      return finalData;
    } catch (error) {
      console.log(error);
      return [];
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics-summary`);
      const data = await res.json();
      setMetrics(data);
    } catch (error) {
      console.log(error);
    }
  };

  const fetchValidation = async () => {
    try {
      const res = await fetch(`${API_BASE}/validation-summary`);
      const data = await res.json();
      setValidation(data);
    } catch (error) {
      console.log(error);
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchReports(), fetchMetrics(), fetchValidation()]);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    const onKeyDown = e => {
      if (e.key === "Escape") {
        setShowAI(false);
        setShowHelpModal(false);
        setShowEditModal(false);
        setPreviewImage("");
        setPreviewReportName("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showToast = text => {
    setMessage(text);
    setTimeout(() => setMessage(""), 3500);
  };

  const handleInputChange = e => {
    const { name, value, files } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: files ? files[0] : value
    }));
  };

  const handleLocationChange = async e => {
    const value = e.target.value;

    setFormData(prev => ({ ...prev, location: value }));

    if (value.trim().length <= 2) {
      setLocationSuggestions([]);
      return;
    }

    try {
      const res = await axios.get("https://photon.komoot.io/api/", {
        params: { q: value, limit: 5 }
      });
      setLocationSuggestions(res.data?.features || []);
    } catch {
      setLocationSuggestions([]);
    }
  };

  const selectLocation = place => {
    setFormData(prev => ({ ...prev, location: place }));
    setLocationSuggestions([]);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported on this browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        try {
          const res = await axios.get("https://photon.komoot.io/reverse", {
            params: { lat, lon }
          });

          const p = res.data?.features?.[0]?.properties || {};
          const text = [
            p.name,
            p.street,
            p.district,
            p.city,
            p.state,
            p.country
          ].filter(Boolean).join(", ");

          setFormData(prev => ({
            ...prev,
            location: text || `${lat}, ${lon}`
          }));
        } catch {
          setFormData(prev => ({
            ...prev,
            location: `${lat}, ${lon}`
          }));
        }
      },
      () => showToast("Unable to access current location")
    );
  };

  const handleSubmit = async e => {
    e.preventDefault();

    try {
      const submitData = new FormData();
      submitData.append("name", formData.name);
      submitData.append("disasterType", formData.disasterType);
      submitData.append("location", formData.location);
      submitData.append("description", formData.description);
      if (formData.image) submitData.append("image", formData.image);

      const res = await fetch(`${API_BASE}/report-emergency`, {
        method: "POST",
        body: submitData
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.message || "Report submission failed");
        return;
      }

      showToast(data.citizenStatus || data.message || "Report submitted");
      setShowForm(false);
      setFormData({
        name: "",
        disasterType: "",
        location: "",
        description: "",
        image: null
      });
      setLocationSuggestions([]);
      await refreshAll();
    } catch (error) {
      console.log(error);
      showToast("Error sending emergency report");
    }
  };

  const buildFallbackAIResponse = report => {
    const type = report?.disasterType || "default";
    const risk = report?.aiPredictedType || "Under review";
    const location = report?.location || "Latest reported location";
    const base = STATIC_AI_GUIDANCE[type] || STATIC_AI_GUIDANCE.default;

    return `Operational Safety Guidance

Incident Type: ${type}
Location: ${location}
Risk Level: ${risk}

${base}`;
  };

  const callAI = async () => {
    setAILoading(true);
    setAIResponse("");
    setAIUsedFallback(false);

    try {
      const currentReports = reports.length ? reports : await fetchReports();
      const latest = currentReports?.[0];

      if (!latest) {
        showToast("No reports found yet");
        setAILoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/ai-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disasterType: latest.disasterType,
          description: latest.description,
          location: latest.location
        })
      });

      const data = await res.json();
      const cleanReply = safeText(data.reply, "");

      if (res.ok && cleanReply) {
        setAIResponse(cleanReply);
        setAIUsedFallback(Boolean(data.fallback));
      } else {
        setAIResponse(buildFallbackAIResponse(latest));
        setAIUsedFallback(true);
      }

      setShowAI(true);
    } catch {
      setAIResponse(buildFallbackAIResponse(reports?.[0]));
      setAIUsedFallback(true);
      setShowAI(true);
    }

    setAILoading(false);
  };

  const fetchHelpCenters = async () => {
    try {
      const currentReports = reports.length ? reports : await fetchReports();
      const latest = currentReports?.[0];

      if (!latest) {
        showToast("No reports found yet");
        return;
      }

      if (latest.latitude == null || latest.longitude == null) {
        showToast("Latest report has no valid location");
        return;
      }

      const res = await fetch(
        `${API_BASE}/nearby-help?lat=${latest.latitude}&lon=${latest.longitude}&disasterType=${encodeURIComponent(latest.disasterType || "")}`
      );

      const data = await res.json();

      if (!res.ok || !Array.isArray(data.centers) || !data.centers.length) {
        showToast(data.message || "Could not load help centers");
        return;
      }

      const enhanced = data.centers.map(place => ({
        ...place,
        phone: getSafePhone(place),
        routeUrl: buildDirectionsUrl({
          fromLat: latest.latitude,
          fromLon: latest.longitude,
          toLat: place.latitude,
          toLon: place.longitude,
          label: place.name
        })
      }));

      const best = data.bestOption
        ? {
            ...data.bestOption,
            phone: getSafePhone(data.bestOption),
            routeUrl: buildDirectionsUrl({
              fromLat: latest.latitude,
              fromLon: latest.longitude,
              toLat: data.bestOption.latitude,
              toLon: data.bestOption.longitude,
              label: data.bestOption.name
            })
          }
        : enhanced[0];

      setHelpCenters(enhanced);
      setBestHelpCenter(best);
      setIncidentForHelpRoute(latest);
      setShowHelpModal(true);
    } catch (error) {
      console.log(error);
      showToast("Could not load help centers");
    }
  };

  const updateReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/update-report/${editingReportId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editData)
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.message || "Update failed");
        return;
      }

      showToast(data.message || "Report updated");
      setShowEditModal(false);
      setEditingReportId(null);
      setEditData({ disasterType: "", location: "", description: "" });
      await refreshAll();
    } catch {
      showToast("Error updating report");
    }
  };

  const deleteReport = async id => {
    try {
      const res = await fetch(`${API_BASE}/delete-report/${id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      showToast(data.message || "Report deleted");
      await refreshAll();
    } catch {
      showToast("Delete failed");
    }
  };

  const updateWorkflow = async (id, workflowStatus, adminDecision) => {
    try {
      const res = await fetch(`${API_BASE}/update-workflow/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowStatus,
          adminDecision,
          dispatchNote: workflowNote
        })
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.message || "Workflow update failed");
        return;
      }

      showToast(data.message || "Workflow updated");
      setWorkflowNote("");
      await refreshAll();
    } catch {
      showToast("Could not update workflow");
    }
  };

  const dashboardReports = useMemo(() => {
    let filtered = [...reports];

    if (dashboardSearch.trim()) {
      const q = dashboardSearch.toLowerCase();
      filtered = filtered.filter(r =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.location || "").toLowerCase().includes(q) ||
        String(r.description || "").toLowerCase().includes(q) ||
        String(r.disasterType || "").toLowerCase().includes(q)
      );
    }

    if (riskFilter !== "All") filtered = filtered.filter(r => r.aiPredictedType === riskFilter);
    if (disasterFilter !== "All") filtered = filtered.filter(r => r.disasterType === disasterFilter);
    if (workflowFilter !== "All") filtered = filtered.filter(r => r.workflowStatus === workflowFilter);
    if (verificationFilter !== "All") filtered = filtered.filter(r => r.verificationStatus === verificationFilter);

    filtered.sort((a, b) => {
      if (sortBy === "risk-desc") {
        return (priorityOrder[a.aiPredictedType] || 5) - (priorityOrder[b.aiPredictedType] || 5) ||
          new Date(b.createdAt) - new Date(a.createdAt);
      }
      if (sortBy === "time-desc") return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === "time-asc") return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""));
      if (sortBy === "verification") {
        const order = { suspicious: 1, pending: 2, verified: 3 };
        return (order[a.verificationStatus] || 4) - (order[b.verificationStatus] || 4);
      }
      return 0;
    });

    return filtered;
  }, [reports, dashboardSearch, riskFilter, disasterFilter, workflowFilter, verificationFilter, sortBy]);

  const uniqueDisasters = [...new Set(reports.map(r => r.disasterType).filter(Boolean))];
  const uniqueWorkflows = [...new Set(reports.map(r => r.workflowStatus).filter(Boolean))];
  const uniqueRisks = [...new Set(reports.map(r => r.aiPredictedType).filter(Boolean))];

  return (
    <>
      <style>{globalCss}</style>

      <div style={styles.page}>
        <div style={styles.overlay} />

        <nav style={styles.navbar}>
          <div style={styles.logo}>ResQAI</div>

          <div style={styles.navLinks}>
            <button style={styles.navLink} onClick={() => {
              setShowDashboard(false);
              setShowForm(false);
              setShowMap(false);
            }}>Home</button>

            <button style={styles.navLink} onClick={() => {
              setShowForm(true);
              setShowDashboard(false);
              setShowMap(false);
            }}>Emergency</button>

            <button style={styles.navLink} onClick={async () => {
              setShowDashboard(true);
              setShowForm(false);
              setShowMap(false);
              await refreshAll();
            }}>Dashboard</button>

            <button style={styles.navLink} onClick={async () => {
              setShowMap(true);
              setShowDashboard(false);
              setShowForm(false);
              await refreshAll();
            }}>Live Map</button>
          </div>
        </nav>

        {!showDashboard && !showMap && !showForm && (
          <>
            <section style={styles.hero}>
              <p style={styles.badge}>AI-Powered Disaster Intelligence</p>

              <h1 style={styles.heroTitle}>
                Smart Emergency Response
                <br />
                for Critical Situations
              </h1>

              <p style={styles.heroSubtitle}>
                ResQAI helps citizens report emergencies instantly and enables faster response using AI triage,
                evidence review, live maps, nearby help routing, and response workflow tracking.
              </p>

              <div style={styles.sdgRibbon}>
                Built for <strong>SDG 11</strong> & <strong>SDG 13</strong> — safer cities and climate resilience.
              </div>

              <div style={styles.betaBadge}>
                🟢 Beta Demo Build · Response Intelligence Prototype
              </div>

              {isLocalhost && (
                <div style={styles.privateDevHint}>
                  Local backend active. This note is hidden from public demo styling.
                </div>
              )}

              <div style={styles.heroButtons}>
                <button style={styles.primaryButton} onClick={() => {
                  setShowForm(true);
                  setShowDashboard(false);
                  setShowMap(false);
                }}>
                  Report Emergency
                </button>

                <button style={styles.secondaryButton} onClick={async () => {
                  setShowDashboard(true);
                  setShowForm(false);
                  setShowMap(false);
                  await refreshAll();
                }}>
                  Explore Dashboard
                </button>
              </div>
            </section>

            <p style={styles.centerHint}>
              AI prioritizes incidents using severity, evidence, location, duplicate clustering, and response readiness.
            </p>

            <div style={styles.demoStatsRow}>
              <MetricCard number={metrics?.totalReports ?? reports.length} label="Reports Tracked" />
              <MetricCard number={metrics?.assignedRescues ?? 0} label="Rescues Assigned" />
              <MetricCard number={metrics?.aiFlagsIssued ?? 0} label="AI Flags Issued" />
              <MetricCard number={metrics?.crossReferencedReports ?? 0} label="Reports Cross-Referenced" />
            </div>

            <section style={styles.cardGrid}>
              <HomeCard icon="🚨" title="Report Emergency" text="Citizens can submit location, description, and image evidence." button="Open Form" onClick={() => setShowForm(true)} />
              <HomeCard icon="📍" title="Live Disaster Map" text="View real geocoded incidents and response hotspots." button="View Map" onClick={() => setShowMap(true)} />
              <HomeCard icon="🤖" title="AI Risk Analysis" text="Analyze urgency, evidence, mismatch, and response priority." button="Open AI Assistant" onClick={callAI} />
              <HomeCard icon="🏥" title="Nearby Help Centers" text="Find hospitals, police, and fire stations with correct emergency-to-help-center route." button="Find Help" onClick={fetchHelpCenters} />
            </section>
          </>
        )}

        {showForm && !showDashboard && !showMap && (
          <section style={styles.formWrapper}>
            <form onSubmit={handleSubmit} style={styles.formCard}>
              <h2 style={styles.formTitle}>Emergency Report Form</h2>

              <div style={styles.formBanner}>
                Submit details for AI triage, evidence review, live map plotting, and response workflow tracking.
              </div>

              <input style={styles.input} name="name" placeholder="Your Name" value={formData.name} onChange={handleInputChange} required />

              <select style={styles.input} name="disasterType" value={formData.disasterType} onChange={handleInputChange} required>
                <option value="">Select Disaster Type</option>
                <option value="Flood">Flood</option>
                <option value="Fire">Fire</option>
                <option value="Earthquake">Earthquake</option>
                <option value="Landslide">Landslide</option>
              </select>

              <div style={{ position: "relative" }}>
                <input
                  style={styles.input}
                  name="location"
                  placeholder="Enter area / city / landmark"
                  value={formData.location}
                  onChange={handleLocationChange}
                  required
                />

                {locationSuggestions.length > 0 && (
                  <div style={styles.dropdown}>
                    {locationSuggestions.map((place, index) => {
                      const p = place.properties || {};
                      const fullText = [
                        p.name,
                        p.street,
                        p.district,
                        p.city,
                        p.state,
                        p.country
                      ].filter(Boolean).join(", ");

                      return (
                        <div key={index} style={styles.dropdownItem} onClick={() => selectLocation(fullText)}>
                          {fullText}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button type="button" style={styles.locationButton} onClick={handleUseMyLocation}>
                Use My Current Location
              </button>

              <textarea
                style={styles.textarea}
                name="description"
                placeholder="Describe the emergency in detail"
                value={formData.description}
                onChange={handleInputChange}
                required
              />

              <input style={styles.input} type="file" name="image" accept="image/*" onChange={handleInputChange} />

              <div style={styles.noteBox}>
                After submission, ResQAI performs AI triage, evidence review, duplicate checking, and responder routing.
              </div>

              <button type="submit" style={styles.submitButton}>
                Submit Emergency
              </button>
            </form>
          </section>
        )}

        {showDashboard && (
          <section style={styles.dashboardSection}>
            <div style={styles.dashboardHeader}>
              <h1 style={styles.dashboardTitle}>ResQAI Response Dashboard</h1>
              <p style={styles.dashboardSubtitle}>
                Executive triage dashboard for severity, evidence, routing, duplicate clusters, and response decisions.
              </p>
            </div>

            <div style={styles.statsBox}>
              <h2 style={styles.statsHeading}>Operational Snapshot</h2>
              <div style={styles.statsRow}>
                <MiniStat label="Total Reports" value={metrics?.totalReports ?? reports.length} />
                <MiniStat label="Verified" value={metrics?.verifiedReports ?? 0} />
                <MiniStat label="Suspicious" value={metrics?.suspiciousReports ?? 0} />
                <MiniStat label="AI Flags Issued" value={metrics?.aiFlagsIssued ?? 0} />
                <MiniStat label="Cross-Referenced" value={metrics?.crossReferencedReports ?? 0} />
                <MiniStat label="Avg Triage" value={`${metrics?.avgTriageSeconds ?? 0}s`} />
              </div>
            </div>

            {validation && (
              <div style={styles.impactBox}>
                <h3 style={styles.impactTitle}>Impact Proof</h3>
                <div style={styles.impactGrid}>
                  {(validation.impactBullets || []).map((item, index) => (
                    <div key={index} style={styles.impactItem}>✓ {item}</div>
                  ))}
                </div>
              </div>
            )}

            <div style={styles.controlPanel}>
              <div style={styles.controlRow}>
                <input style={styles.controlInput} value={dashboardSearch} onChange={e => setDashboardSearch(e.target.value)} placeholder="Search reports" />

                <select style={styles.controlSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="risk-desc">Sort: Highest Risk</option>
                  <option value="time-desc">Sort: Newest First</option>
                  <option value="time-asc">Sort: Oldest First</option>
                  <option value="name-asc">Sort: Name A-Z</option>
                  <option value="verification">Sort: Verification</option>
                </select>

                <select style={styles.controlSelect} value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
                  <option value="All">All Risks</option>
                  {uniqueRisks.map(risk => <option key={risk} value={risk}>{risk}</option>)}
                </select>

                <select style={styles.controlSelect} value={disasterFilter} onChange={e => setDisasterFilter(e.target.value)}>
                  <option value="All">All Disasters</option>
                  {uniqueDisasters.map(type => <option key={type} value={type}>{type}</option>)}
                </select>

                <select style={styles.controlSelect} value={workflowFilter} onChange={e => setWorkflowFilter(e.target.value)}>
                  <option value="All">All Workflows</option>
                  {uniqueWorkflows.map(w => <option key={w} value={w}>{w}</option>)}
                </select>

                <select style={styles.controlSelect} value={verificationFilter} onChange={e => setVerificationFilter(e.target.value)}>
                  <option value="All">All Verification</option>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="suspicious">Suspicious</option>
                </select>
              </div>

              <div style={styles.controlFooter}>
                <span>Showing <strong>{dashboardReports.length}</strong> of <strong>{reports.length}</strong> reports</span>
                <button style={styles.clearFiltersButton} onClick={() => {
                  setDashboardSearch("");
                  setRiskFilter("All");
                  setDisasterFilter("All");
                  setWorkflowFilter("All");
                  setVerificationFilter("All");
                  setSortBy("risk-desc");
                }}>Reset Filters</button>
              </div>
            </div>

            <textarea
              style={styles.workflowTextarea}
              value={workflowNote}
              onChange={e => setWorkflowNote(e.target.value)}
              placeholder="Optional admin dispatch note..."
            />

            <div style={styles.reportGrid}>
              {dashboardReports.length ? dashboardReports.map(report => {
                const imageUrl = report.imageUrl
                  ? `${API_BASE}${report.imageUrl}`
                  : "";

                return (
                  <div key={report._id} style={styles.reportCard}>
                    <div style={styles.topBadgeRow}>
                      <StatusBadge status={report.verificationStatus} />
                      <span style={{ ...styles.typeBadge, background: getDisasterColor(report.disasterType) }}>
                        {report.disasterType}
                      </span>
                      {report.aiEvidenceStatus === "Evidence Attached" && (
                        <span style={styles.evidenceBadge}>📎 Evidence</span>
                      )}
                    </div>

                    <h3 style={styles.reportName}>{report.name}</h3>

                    <div style={styles.compactInfo}>
                      <p><strong>Location:</strong> {report.location}</p>
                      <p><strong>Description:</strong> {report.description}</p>
                    </div>

                    <div style={styles.executiveRow}>
                      <span style={{ ...styles.riskPill, background: getRiskColor(report.aiPredictedType) }}>
                        🚨 {report.aiPredictedType || "Under review"}
                      </span>
                      <span style={{ ...styles.workflowPill, background: getWorkflowColor(report.workflowStatus) }}>
                        {report.workflowStatus || "Submitted"}
                      </span>
                    </div>

                    <div style={styles.analysisBox}>
                      <p><strong>Detected:</strong> {safeText(report.aiDetectedDisasterType, report.disasterType)}</p>
                      <p><strong>Image:</strong> {safeText(report.aiImageDetectedType, report.imageUrl ? "Evidence under review" : "No evidence uploaded")}</p>
                      <p><strong>Confidence:</strong> {report.confidenceScore ?? 0}%</p>
                      <p><strong>Priority Rank:</strong> P{report.priorityRank || 4}</p>
                    </div>

                    {report.aiMismatchDetected ? (
                      <div style={styles.mismatchBadge}>⚠️ Evidence mismatch flagged</div>
                    ) : (
                      <div style={styles.matchBadgeGreen}>✓ {safeText(report.aiMatchLabel, "Evidence status reviewed")}</div>
                    )}

                    <p style={styles.reasonText}>
                      {safeText(report.decisionSummary || report.aiReason, "Risk estimated from submitted report details.")}
                    </p>

                    <p style={styles.helpSummary}>
                      <strong>Nearest Help:</strong> {safeText(report.nearestHelpSummary, "Responder options available from Help Centers.")}
                    </p>

                    {imageUrl && (
                      <button style={styles.smallButton} onClick={() => {
                        setPreviewImage(imageUrl);
                        setPreviewReportName(report.name || "Evidence");
                      }}>
                        View Evidence
                      </button>
                    )}

                    <div style={styles.actionRow}>
                      <button style={styles.smallButton} onClick={() => {
                        setEditingReportId(report._id);
                        setEditData({
                          disasterType: report.disasterType || "",
                          location: report.location || "",
                          description: report.description || ""
                        });
                        setShowEditModal(true);
                      }}>Edit</button>

                      <button style={styles.smallButton} onClick={() => updateWorkflow(report._id, "Verified", "Verified by Admin")}>Verify</button>
                      <button style={styles.smallButton} onClick={() => updateWorkflow(report._id, "Rescue Assigned", "Dispatch Team")}>Assign Rescue</button>
                      <button style={styles.dangerButton} onClick={() => deleteReport(report._id)}>Delete</button>
                    </div>
                  </div>
                );
              }) : (
                <p style={styles.emptyText}>No reports match the selected filters.</p>
              )}
            </div>
          </section>
        )}

        {showMap && (
          <section style={styles.mapSection}>
            <h1 style={styles.dashboardTitle}>Live Disaster Map</h1>
            <p style={styles.dashboardSubtitle}>
              Real geocoded emergency reports with disaster-specific markers.
            </p>

            <div style={styles.mapBox}>
              <MapContainer center={[28.6139, 77.209]} zoom={5} style={{ height: "100%", width: "100%" }}>
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <FitMapToReports reports={validReports} />

                {validReports.map(report => (
                  <Marker
                    key={report._id}
                    position={[report.latitude, report.longitude]}
                    icon={getCustomIcon(report.disasterType)}
                  >
                    <Popup>
                      <strong>{report.disasterType}</strong><br />
                      {report.name}<br />
                      {report.location}<br />
                      Risk: {report.aiPredictedType}<br />
                      Workflow: {report.workflowStatus}
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </section>
        )}

        {message && <div style={styles.messageBox}>{message}</div>}

        <FloatingActions callAI={callAI} fetchHelpCenters={fetchHelpCenters} aiLoading={aiLoading} />

        {showAI && (
          <Modal title="AI Emergency Assistant" onClose={() => setShowAI(false)}>
            {aiUsedFallback && <div style={styles.betaBadge}>Operational guidance mode active</div>}
            <pre style={styles.aiText}>{safeText(aiResponse, buildFallbackAIResponse(latestReport))}</pre>
          </Modal>
        )}

        {showHelpModal && (
          <Modal title="Nearby Help Centers" onClose={() => setShowHelpModal(false)}>
            {incidentForHelpRoute && (
              <div style={styles.routeInfo}>
                Route origin: emergency report location → selected help center
              </div>
            )}

            {bestHelpCenter && (
              <div style={styles.bestBox}>
                <h3>Best Option</h3>
                <p><strong>{bestHelpCenter.name}</strong></p>
                <p>{bestHelpCenter.type?.replace("_", " ")} · {Number(bestHelpCenter.distanceKm || 0).toFixed(1)} km</p>
                <p>Phone: {getSafePhone(bestHelpCenter)}</p>
                <a style={styles.routeButton} href={bestHelpCenter.routeUrl} target="_blank" rel="noreferrer">
                  Open Route
                </a>
              </div>
            )}

            <div style={styles.helpList}>
              {helpCenters.map((place, index) => (
                <div key={index} style={styles.helpCard}>
                  <h3>{place.name}</h3>
                  <p>{place.type?.replace("_", " ")} · {Number(place.distanceKm || 0).toFixed(1)} km</p>
                  <p>Phone: {getSafePhone(place)}</p>
                  <div style={styles.actionRow}>
                    <a style={styles.smallLink} href={place.mapsUrl} target="_blank" rel="noreferrer">Open Map</a>
                    <a style={styles.smallLink} href={place.routeUrl} target="_blank" rel="noreferrer">Open Route</a>
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        )}

        {previewImage && (
          <Modal title={previewReportName} onClose={() => setPreviewImage("")}>
            <img src={previewImage} alt="Evidence" style={styles.previewImage} />
          </Modal>
        )}

        {showEditModal && (
          <Modal title="Edit Report" onClose={() => setShowEditModal(false)}>
            <select style={styles.input} value={editData.disasterType} onChange={e => setEditData(prev => ({ ...prev, disasterType: e.target.value }))}>
              <option value="Flood">Flood</option>
              <option value="Fire">Fire</option>
              <option value="Earthquake">Earthquake</option>
              <option value="Landslide">Landslide</option>
            </select>

            <input style={styles.input} value={editData.location} onChange={e => setEditData(prev => ({ ...prev, location: e.target.value }))} />
            <textarea style={styles.textarea} value={editData.description} onChange={e => setEditData(prev => ({ ...prev, description: e.target.value }))} />

            <button style={styles.submitButton} onClick={updateReport}>Save Changes</button>
          </Modal>
        )}
      </div>
    </>
  );
}

function MetricCard({ number, label }) {
  return (
    <div style={styles.demoStatCard}>
      <div style={styles.demoStatNumber}>{number}</div>
      <div style={styles.demoStatLabel}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={styles.statMiniCard}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function HomeCard({ icon, title, text, button, onClick }) {
  return (
    <div style={styles.card}>
      <div style={styles.icon}>{icon}</div>
      <h2 style={styles.cardTitle}>{title}</h2>
      <p style={styles.cardText}>{text}</p>
      <button style={styles.cardButton} onClick={onClick}>{button}</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const label =
    status === "verified" ? "✅ Verified" :
    status === "suspicious" ? "⚠️ Suspicious" :
    "⏳ Pending";

  const color =
    status === "verified" ? "#2ecc71" :
    status === "suspicious" ? "#ffb266" :
    "#d0d6e2";

  return (
    <span style={{
      ...styles.statusBadge,
      color,
      borderColor: color,
      background: `${color}22`
    }}>
      {label}
    </span>
  );
}

function FloatingActions({ callAI, fetchHelpCenters, aiLoading }) {
  return (
    <div style={styles.floatingActions}>
      <button style={styles.floatButton} onClick={callAI}>
        {aiLoading ? "AI..." : "🤖 AI"}
      </button>
      <button style={styles.floatButton} onClick={fetchHelpCenters}>
        🏥 Help
      </button>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2>{title}</h2>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const globalCss = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #050816; color: white; font-family: Inter, system-ui, Arial, sans-serif; }
  button, input, textarea, select { font-family: inherit; }
  input::placeholder, textarea::placeholder { color: rgba(230,240,255,.55); }
  select option { color: #111827; }
  @keyframes pulse { 0%{transform:scale(1)} 50%{transform:scale(1.04)} 100%{transform:scale(1)} }
`;

const glass = {
  background: "rgba(10, 20, 38, 0.78)",
  border: "1px solid rgba(143, 233, 255, 0.18)",
  boxShadow: "0 24px 80px rgba(0,0,0,.35)",
  backdropFilter: "blur(18px)"
};

const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, #12385a 0, transparent 35%), radial-gradient(circle at top right, #3a174f 0, transparent 30%), #050816",
    position: "relative",
    paddingBottom: 80
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "linear-gradient(120deg, rgba(0, 217, 255, .08), rgba(255,255,255,0))",
    pointerEvents: "none"
  },
  navbar: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 7%",
    ...glass
  },
  logo: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "-1px",
    color: "#8fe9ff"
  },
  navLinks: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap"
  },
  navLink: {
    background: "transparent",
    border: "0",
    color: "#eaf7ff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15
  },
  hero: {
    textAlign: "center",
    padding: "90px 7% 35px",
    position: "relative",
    zIndex: 2
  },
  badge: {
    display: "inline-block",
    padding: "10px 18px",
    borderRadius: 999,
    color: "#8fe9ff",
    background: "rgba(143,233,255,.12)",
    border: "1px solid rgba(143,233,255,.25)",
    fontWeight: 800
  },
  heroTitle: {
    fontSize: "clamp(42px, 7vw, 86px)",
    lineHeight: 1,
    margin: "24px 0",
    letterSpacing: "-3px",
  
    color: "#ffffff",
    textShadow: "0 4px 20px rgba(0,0,0,0.6)"
  },
  heroSubtitle: {
    maxWidth: 850,
    margin: "0 auto",
    fontSize: 19,
    lineHeight: 1.7,
    color: "#eaf6ff"   // brighter
  },
  sdgRibbon: {
    display: "inline-block",
    marginTop: 24,
    padding: "14px 18px",
    borderRadius: 18,
    background: "rgba(46,204,113,.13)",
    border: "1px solid rgba(46,204,113,.25)"
  },
  betaBadge: {
    display: "inline-block",
    marginTop: 18,
    padding: "10px 16px",
    borderRadius: 999,
    background: "rgba(46,204,113,.14)",
    border: "1px solid rgba(46,204,113,.3)",
    color: "#8dffbe",
    fontWeight: 800
  },
  privateDevHint: {
    maxWidth: 520,
    margin: "14px auto 0",
    opacity: 0.45,
    fontSize: 12
  },
  heroButtons: {
    display: "flex",
    justifyContent: "center",
    gap: 18,
    marginTop: 34,
    flexWrap: "wrap"
  },
  primaryButton: {
    border: 0,
    padding: "16px 26px",
    borderRadius: 18,
    background: "#8fe9ff",
    color: "#06111f",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 16
  },
  secondaryButton: {
    border: "1px solid rgba(255,255,255,.25)",
    padding: "16px 26px",
    borderRadius: 18,
    background: "rgba(255,255,255,.08)",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: 16
  },
  centerHint: {
    textAlign: "center",
    color: "#cfe7f7",
    margin: "10px auto 28px",
    maxWidth: 820
  },
  demoStatsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 18,
    padding: "0 7%",
    marginBottom: 34
  },
  demoStatCard: {
    ...glass,
    borderRadius: 24,
    padding: 22,
    textAlign: "center"
  },
  demoStatNumber: {
    fontSize: 34,
    fontWeight: 900,
    color: "#8fe9ff"
  },
  demoStatLabel: {
    marginTop: 8,
    color: "#d7e5ef",
    fontWeight: 700
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: 22,
    padding: "0 7%"
  },
  card: {
    ...glass,
    borderRadius: 28,
    padding: 28
  },
  icon: {
    fontSize: 36
  },
  cardTitle: {
    fontSize: 24,
    marginBottom: 10
  },
  cardText: {
    color: "#c9d8e5",
    lineHeight: 1.6
  },
  cardButton: {
    marginTop: 18,
    border: 0,
    padding: "12px 18px",
    borderRadius: 14,
    background: "rgba(143,233,255,.15)",
    color: "#8fe9ff",
    fontWeight: 900,
    cursor: "pointer"
  },
  formWrapper: {
    padding: "45px 7%"
  },
  formCard: {
    ...glass,
    maxWidth: 760,
    margin: "0 auto",
    borderRadius: 30,
    padding: 30
  },
  formTitle: {
    fontSize: 34,
    marginTop: 0
  },
  formBanner: {
    padding: 14,
    borderRadius: 16,
    background: "rgba(143,233,255,.1)",
    marginBottom: 18,
    color: "#dff8ff"
  },
  input: {
    width: "100%",
    padding: "15px 16px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.15)",
    background: "rgba(255,255,255,.08)",
    color: "white",
    marginBottom: 14,
    outline: "none"
  },
  textarea: {
    width: "100%",
    minHeight: 120,
    padding: "15px 16px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.15)",
    background: "rgba(255,255,255,.08)",
    color: "white",
    marginBottom: 14,
    outline: "none",
    resize: "vertical"
  },
  dropdown: {
    position: "absolute",
    zIndex: 20,
    top: 56,
    left: 0,
    right: 0,
    background: "#0b1729",
    border: "1px solid rgba(143,233,255,.25)",
    borderRadius: 16,
    overflow: "hidden"
  },
  dropdownItem: {
    padding: 13,
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,.08)"
  },
  locationButton: {
    width: "100%",
    padding: 13,
    borderRadius: 16,
    border: "1px solid rgba(143,233,255,.25)",
    background: "rgba(143,233,255,.1)",
    color: "#8fe9ff",
    fontWeight: 900,
    marginBottom: 14,
    cursor: "pointer"
  },
  noteBox: {
    padding: 14,
    borderRadius: 16,
    background: "rgba(255,255,255,.06)",
    color: "#cfe7f7",
    marginBottom: 16
  },
  submitButton: {
    width: "100%",
    padding: 15,
    borderRadius: 16,
    border: 0,
    background: "#8fe9ff",
    color: "#06111f",
    fontWeight: 900,
    cursor: "pointer"
  },
  dashboardSection: {
    padding: "45px 7%"
  },
  dashboardHeader: {
    marginBottom: 24
  },
  dashboardTitle: {
    fontSize: "clamp(34px, 5vw, 58px)",
    margin: 0
  },
  dashboardSubtitle: {
    color: "#cbdce9",
    maxWidth: 900,
    lineHeight: 1.6
  },
  statsBox: {
    ...glass,
    borderRadius: 26,
    padding: 22,
    marginBottom: 20
  },
  statsHeading: {
    marginTop: 0
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 14
  },
  statMiniCard: {
    padding: 16,
    borderRadius: 18,
    background: "rgba(255,255,255,.07)",
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  impactBox: {
    ...glass,
    borderRadius: 26,
    padding: 22,
    marginBottom: 20
  },
  impactTitle: {
    marginTop: 0
  },
  impactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12
  },
  impactItem: {
    padding: 14,
    borderRadius: 16,
    background: "rgba(46,204,113,.1)",
    color: "#baf7cf"
  },
  controlPanel: {
    ...glass,
    borderRadius: 26,
    padding: 20,
    marginBottom: 18
  },
  controlRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12
  },
  controlInput: {
    padding: 13,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.15)",
    background: "rgba(255,255,255,.08)",
    color: "white"
  },
  controlSelect: {
    padding: 13,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.15)",
    background: "rgba(255,255,255,.08)",
    color: "white"
  },
  controlFooter: {
    marginTop: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap"
  },
  clearFiltersButton: {
    border: 0,
    padding: "10px 14px",
    borderRadius: 12,
    background: "rgba(255,255,255,.1)",
    color: "white",
    cursor: "pointer"
  },
  workflowTextarea: {
    width: "100%",
    minHeight: 70,
    padding: 15,
    borderRadius: 18,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.15)",
    color: "white",
    marginBottom: 18
  },
  reportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
    gap: 20
  },
  reportCard: {
    ...glass,
    borderRadius: 28,
    padding: 22
  },
  topBadgeRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center"
  },
  statusBadge: {
    display: "inline-block",
    padding: "7px 11px",
    borderRadius: 999,
    border: "1px solid",
    fontWeight: 900,
    fontSize: 12
  },
  typeBadge: {
    display: "inline-block",
    padding: "7px 11px",
    borderRadius: 999,
    color: "#03111d",
    fontWeight: 900,
    fontSize: 12
  },
  evidenceBadge: {
    padding: "7px 11px",
    borderRadius: 999,
    background: "rgba(143,233,255,.14)",
    color: "#8fe9ff",
    fontWeight: 900,
    fontSize: 12
  },
  reportName: {
    fontSize: 23,
    marginBottom: 10
  },
  compactInfo: {
    color: "#d7e7f2",
    lineHeight: 1.45
  },
  executiveRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    margin: "14px 0"
  },
  riskPill: {
    padding: "9px 12px",
    borderRadius: 14,
    color: "#05111f",
    fontWeight: 900
  },
  workflowPill: {
    padding: "9px 12px",
    borderRadius: 14,
    color: "#05111f",
    fontWeight: 900
  },
  analysisBox: {
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,.06)",
    color: "#dcecf7",
    lineHeight: 1.3
  },
  mismatchBadge: {
    padding: 12,
    borderRadius: 16,
    background: "rgba(255,159,67,.14)",
    color: "#ffc28a",
    marginTop: 12,
    fontWeight: 900
  },
  matchBadgeGreen: {
    padding: 12,
    borderRadius: 16,
    background: "rgba(46,204,113,.12)",
    color: "#aaf5c5",
    marginTop: 12,
    fontWeight: 900
  },
  reasonText: {
    color: "#cbdce9",
    lineHeight: 1.55
  },
  helpSummary: {
    color: "#d7e7f2"
  },
  actionRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 12
  },
  smallButton: {
    border: 0,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(143,233,255,.14)",
    color: "#8fe9ff",
    fontWeight: 900,
    cursor: "pointer"
  },
  dangerButton: {
    border: 0,
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,77,79,.15)",
    color: "#ff8b8d",
    fontWeight: 900,
    cursor: "pointer"
  },
  emptyText: {
    color: "#cbdce9"
  },
  mapSection: {
    padding: "45px 7%"
  },
  mapBox: {
    height: "70vh",
    borderRadius: 28,
    overflow: "hidden",
    border: "1px solid rgba(143,233,255,.25)"
  },
  messageBox: {
    position: "fixed",
    bottom: 25,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
    padding: "14px 20px",
    borderRadius: 18,
    background: "#8fe9ff",
    color: "#06111f",
    fontWeight: 900
  },
  floatingActions: {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 80,
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  floatButton: {
    border: 0,
    borderRadius: 999,
    padding: "14px 18px",
    background: "#8fe9ff",
    color: "#06111f",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 14px 34px rgba(0,0,0,.35)"
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "rgba(0,0,0,.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18
  },
  modal: {
    ...glass,
    width: "min(850px, 96vw)",
    maxHeight: "88vh",
    overflow: "auto",
    borderRadius: 28,
    padding: 24
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: 0,
    background: "rgba(255,255,255,.1)",
    color: "white",
    fontSize: 26,
    cursor: "pointer"
  },
  aiText: {
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    lineHeight: 1.6,
    color: "#e8f7ff"
  },
  routeInfo: {
    padding: 13,
    borderRadius: 16,
    background: "rgba(143,233,255,.11)",
    color: "#8fe9ff",
    marginBottom: 14,
    fontWeight: 800
  },
  bestBox: {
    padding: 18,
    borderRadius: 22,
    background: "rgba(46,204,113,.12)",
    border: "1px solid rgba(46,204,113,.22)",
    marginBottom: 16
  },
  routeButton: {
    display: "inline-block",
    padding: "11px 14px",
    borderRadius: 14,
    background: "#8fe9ff",
    color: "#06111f",
    textDecoration: "none",
    fontWeight: 900
  },
  helpList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 14
  },
  helpCard: {
    padding: 16,
    borderRadius: 20,
    background: "rgba(255,255,255,.07)"
  },
  smallLink: {
    padding: "9px 11px",
    borderRadius: 12,
    background: "rgba(143,233,255,.13)",
    color: "#8fe9ff",
    textDecoration: "none",
    fontWeight: 900
  },
  previewImage: {
    width: "100%",
    borderRadius: 20,
    maxHeight: "70vh",
    objectFit: "contain"
  }
};