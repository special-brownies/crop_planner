# 🌾 Stardew Valley Crop Planner — Modernized Fork

An updated and modernized fork of the original Stardew Valley Crop Planner by exnil, fully upgraded to support **Stardew Valley 1.6+ data**, improved economic calculations, and enhanced UI behavior.

This fork focuses on **accuracy, completeness, and maintainability**, bringing the planner in line with the latest game mechanics.

---

# ✨ What’s New in This Fork

## 🆕 Stardew Valley 1.6 Support
- Updated crop dataset using extracted game data
- Added new 1.6 crops:
  - Carrot  
  - Summer Squash  
  - Broccoli  
  - Powdermelon  
- Updated growth and regrowth logic to match latest values

---

## 💰 Accurate Economic Simulation
### Seed Cost Integration
- Planting cost now includes:
  - Fertilizer price (where applicable)
- Net profit and ROI now calculated correctly

### Fertilizer Effects Implemented
- Speed-Gro
- Deluxe Speed-Gro
- Hyper Speed-Gro
- Basic Fertilizer
- Quality Fertilizer
- Deluxe Fertilizer
- Retaining Soil variants

Growth time reductions now correctly affect:
- Harvest date
- Calendar projections
- Profit calculations

---

## 🎨 UI Improvements
- Fixed cost column showing `0g` / `-0g`
- Centered numeric inputs in planting modal
- Corrected crop image loading for new crops
- Improved visual alignment in planting table

---

# 🧠 Under the Hood Changes
- Refactored cost calculation pipeline
- Removed legacy cost fields (`buy`, `cost`)
- Normalized crop object structure
- Improved event lifecycle logic

---

# 🚀 How to Run Locally

Because the planner loads JSON files, you must run it through a local server.

## Python (recommended)
```bash
cd crop_planner
python -m http.server 8000
```
Then open:
```bash
http://localhost:8000
```
