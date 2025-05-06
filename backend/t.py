import matplotlib.pyplot as plt
import pandas as pd
import datetime
from matplotlib.dates import DateFormatter

# Define task data
tasks = [
    ("Define project scope", "2025-01-06", "2025-01-12"),
    ("Set up dev environment", "2025-01-06", "2025-01-12"),
    ("Create GitHub repo and structure", "2025-01-06", "2025-01-12"),
    ("Conduct stakeholder interviews", "2025-01-13", "2025-01-26"),
    ("Design system architecture", "2025-01-13", "2025-01-26"),
    ("Define user roles and layout", "2025-01-13", "2025-01-26"),
    ("Implement user authentication", "2025-01-27", "2025-02-09"),
    ("Begin session logging module", "2025-01-27", "2025-02-09"),
    ("Set up blockchain & deploy contracts", "2025-01-27", "2025-02-09"),
    ("Integrate usage tracking", "2025-02-10", "2025-02-23"),
    ("Build billing module", "2025-02-10", "2025-02-23"),
    ("Test smart contract invoicing", "2025-02-10", "2025-02-23"),
    ("Optimize UI/UX", "2025-02-24", "2025-03-09"),
    ("Develop admin reporting tools", "2025-02-24", "2025-03-09"),
    ("Integration testing", "2025-02-24", "2025-03-09"),
    ("System-wide testing & fixes", "2025-03-10", "2025-03-23"),
    ("Finalize documentation", "2025-03-10", "2025-03-23"),
    ("Prepare for beta testing", "2025-03-10", "2025-03-23"),
    ("Pilot launch", "2025-03-24", "2025-04-06"),
    ("Collect user feedback", "2025-03-24", "2025-04-06"),
    ("Evaluate satisfaction", "2025-03-24", "2025-04-06"),
    ("Final refinements", "2025-04-07", "2025-04-25"),
    ("Final report preparation", "2025-04-07", "2025-04-25"),
    ("Project presentation", "2025-04-07", "2025-04-25"),
]

# Create DataFrame
df = pd.DataFrame(tasks, columns=["Task", "Start", "End"])
df["Start"] = pd.to_datetime(df["Start"])
df["End"] = pd.to_datetime(df["End"])
df["Duration"] = (df["End"] - df["Start"]).dt.days

# Plot Gantt chart
fig, ax = plt.subplots(figsize=(12, 10))
for i, row in df.iterrows():
    ax.barh(i, row["Duration"], left=row["Start"], color="#4682B4")

ax.set_yticks(range(len(df)))
ax.set_yticklabels(df["Task"])
ax.invert_yaxis()
ax.xaxis.set_major_formatter(DateFormatter("%b %d"))
ax.set_xlabel("Timeline")
ax.set_title("Gantt Chart: Wi-Fi Monitoring & Billing System (Jan 6 – Apr 25, 2025)")

plt.tight_layout()
plt.grid(True, which='major', axis='x', linestyle='--', alpha=0.7)
plt.show()
