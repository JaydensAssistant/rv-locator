<%*
const rv = await tp.user.newRv(tp);
-%>
---
Address: "<% rv.addressYaml %>"
Priority: <% rv.priority %>
Met: "<% rv.created %>"
Last Spoke: "<% rv.created %>"
Last Attempted: "<% rv.created %>"
<% rv.companionYaml %>
Visits: 1
Successful Visits: 1
icon: door-open
color: purple
Hub:
  - "[[Return Visits Hub]]"
cssclasses:
  - "hide-props"
  - "rv-dashboard"
---
> **Hubs:**      `INPUT[inlineListSuggester(optionQuery("")):Hub]`
> **Address:** `INPUT[text:Address]` [🗺️](<% rv.mapUrl %>)

`BUTTON[rv-log-home, rv-log-miss]`

---
> [!rv]- 👤 RV Dashboard
>
> **Priority**
> `INPUT[slider(minValue(0), maxValue(5)):Priority]` `VIEW[{Priority}]`
>
> **Visits**
> `INPUT[number:Visits]`
>
> **Successful Visits**
> `INPUT[number:["Successful Visits"]]`
>
> **Met**
> `INPUT[dateTime:["Met"]]`
>
> **Last Spoke**
> `INPUT[dateTime:["Last Spoke"]]`
>
> **Last Attempted**
> `INPUT[dateTime:["Last Attempted"]]`
>
> **Met With**
> `INPUT[text:["Met With"]]`
>
> **Taken**
> `INPUT[inlineList:Taken]`
### <% rv.stamp %> <span class="rv-stamp-ago"><% rv.ago %></span>


%% rv-locator-digest %%

> No May-go-out days

%% /rv-locator-digest %%

> [!note]- Attempt Log
> - <% rv.stamp %> — success

```meta-bind-button
label: Home
style: primary
class: rv-visit-btn
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/99 RV Log Home.md
```

```meta-bind-button
label: Not home
style: default
class: rv-visit-btn
id: rv-log-miss
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/99 RV Log Miss.md
```
