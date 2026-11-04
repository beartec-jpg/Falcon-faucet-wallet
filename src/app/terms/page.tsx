// Copyright (c) 2026 BEARTEC LTD. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/terms',
  'Terms',
  'Falcon PL testnet allocation programme terms and conditions.',
)

type Block = { p: string } | { list: string[] }

const INTRO: string[] = [
  "Last updated: 4 November 2026",
  "These terms apply to the Falcon PL testnet allocation programme at falcon-fpl.com, including the Falcon arcade (falcon-fpl.com/arcade). By taking part you agree to them. Use of the site, wallet, faucet, arcade and other test features is also covered by our Terms of Use (falcon-fpl.com/terms-of-use), and our Privacy Policy (falcon-fpl.com/privacy) explains how we use personal data."
]

const SECTIONS: { title: string; blocks: Block[] }[] = [
  {
    "title": "1. Who runs it",
    "blocks": [
      {
        "p": "The programme is run by BEARTEC LTD, a company registered in England and Wales (company number 17166952), registered office 33 Salt Works Lane, Weston, Stafford, England, ST18 0LW. In these terms \"we\" and \"us\" means BEARTEC LTD."
      }
    ]
  },
  {
    "title": "2. What counts as a contribution",
    "blocks": [
      {
        "p": "A contribution is any of the following done on the Falcon PL testnet through falcon-fpl.com and recorded by us:"
      },
      {
        "list": [
          "Running a node or an approved validator seat (validator seats need a 50,000 testnet FPL bond and approval by Scott)",
          "Using and testing the wallet, including sending, receiving, backup and restore",
          "Bridging",
          "Swaps and payments",
          "Providing liquidity and lending",
          "Using the faucet",
          "Playing the arcade",
          "Running watchers",
          "Steady use over time (the consistency score)",
          "Sending bug reports, feedback and ideas through the feedback page that we review and accept as valid",
          "Taking a First 35 prize seat or an Arcade top 5 place"
        ]
      },
      {
        "p": "How each category is scored is set out on the methodology page at falcon-fpl.com/scan/methodology. Vault use is not counted."
      }
    ]
  },
  {
    "title": "3. What we intend to do",
    "blocks": [
      {
        "p": "We want to thank the people who help us test Falcon PL. We intend to reward every eligible contribution with an allocation of mainnet FPL at mainnet launch."
      },
      {
        "p": "Allocations are at BEARTEC's discretion. Nothing on this site or in these terms is a binding promise, an offer, or a guarantee of any payment or tokens."
      },
      {
        "p": "Any allocation is planned to come from the community bucket described on falcon-fpl.com/airdrop. Validator seats are planned to be rewarded from the separate operators pool. First 35 seats and Arcade top 5 places are planned to come from the builder pot."
      },
      {
        "p": "Allocation size and formula: final pool sizes, the per-person formula and any caps have not been fixed. The site currently shows proposed figures. Any figures we publish are what we aim for, not a promise."
      }
    ]
  },
  {
    "title": "4. How contributions are recorded",
    "blocks": [
      {
        "p": "Contributions are recorded against your Falcon PL account name and its wallet address, as shown on the activity leaderboard and the /airdrop page. Validator work is recorded against the validator seat. Any allocation is intended for the account that made the contribution. We do not add contributions that were not recorded on our systems. If something looks wrong, tell us through the feedback page before the snapshot."
      }
    ]
  },
  {
    "title": "5. Testnet tokens",
    "blocks": [
      {
        "p": "Testnet FPL has no cash value. It is not the allocation and it will not turn into mainnet FPL. You cannot sell it or swap it for money. It is only there so you can test the network."
      }
    ]
  },
  {
    "title": "6. The snapshot and delivery at mainnet launch",
    "blocks": [
      {
        "p": "Before mainnet genesis we intend to freeze a snapshot of recorded contributions. We intend to work out allocations from that snapshot and aim to credit them to the account at mainnet launch. No snapshot date has been set; we will post it on falcon-fpl.com."
      },
      {
        "p": "How any allocation is delivered (for example credited at genesis or claimed through the wallet), and whether there is a claim window, has not been decided. We will post the details on falcon-fpl.com before the snapshot."
      },
    ]
  },
  {
    "title": "7. Keep your keys",
    "blocks": [
      {
        "p": "You must keep access to your account, wallet address and keys or recovery backup. We cannot recover them for you. If you lose them we may not be able to send you anything, and that is not our fault."
      }
    ]
  },
  {
    "title": "8. Abuse and disqualification",
    "blocks": [
      {
        "p": "You may be disqualified, and get no allocation, if you:"
      },
      {
        "list": [
          "Use more than one account to boost your score (sybil accounts), including linked accounts",
          "Use bots, scripts or other automation to fake activity",
          "Exploit a bug instead of reporting it",
          "Manipulate the leaderboard, arcade or any score in any other way",
          "Break the law or these terms"
        ]
      },
      {
        "p": "We use checks such as linked account detection to spot this. Whether something counts as abuse is BEARTEC's decision and it is final. Reporting a bug properly through the feedback page is a contribution, not abuse."
      }
    ]
  },
  {
    "title": "9. No mainnet date",
    "blocks": [
      {
        "p": "We do not promise a mainnet launch date, or that mainnet will launch at all. There is no fixed mainnet date. We intend to make any allocations at mainnet launch."
      },
      {
        "p": "If mainnet does not launch, there are no allocations."
      }
    ]
  },
  {
    "title": "10. Eligibility",
    "blocks": [
      {
        "p": "To take part and be considered for an allocation you must:"
      },
      {
        "list": [
          "Be 18 or over",
          "Not live in, or be a resident or citizen of, a country under UK, UN, EU or US sanctions, and not be on any sanctions list",
          "Be allowed to receive tokens where you live"
        ]
      },
      {
        "p": "You are responsible for your own legal and tax position, including any tax on the allocation. We may ask for proof of eligibility, which may include identity checks, before making any allocation."
      }
    ]
  },
  {
    "title": "11. Changes to these terms",
    "blocks": [
      {
        "p": "We may update these terms, for example to fix mistakes or add details. Changes will be posted on falcon-fpl.com with a new date. Changes can affect contributions already made, including how they are scored and whether they get an allocation. If you keep taking part after a change, you accept the new terms."
      }
    ]
  },
  {
    "title": "12. No obligation",
    "blocks": [
      {
        "p": "These terms do not create a contract to pay you anything. Taking part does not give you any right to an allocation, tokens or money, and no amount is owed to you. We can change, pause or cancel the programme, or any part of it, at any time and for any reason, including the size of pools, the scoring and who is eligible. If we do, you have no claim against us."
      }
    ]
  },
  {
    "title": "13. Limitation of liability",
    "blocks": [
      {
        "p": "The testnet, wallet, bridges, arcade and site are test software provided as they are. Things can break. Testnet FPL and other test tokens have no value. We are not liable for any loss from using the test software or from lost keys, except where the law does not allow this to be excluded. Nothing here is financial advice and FPL is not an investment. Nothing in these terms limits liability that cannot be limited under English law."
      }
    ]
  },
  {
    "title": "14. Governing law",
    "blocks": [
      {
        "p": "These terms are governed by the law of England and Wales. The courts of England and Wales deal with any dispute."
      }
    ]
  },
  {
    "title": "15. Contact",
    "blocks": [
      {
        "p": "Questions: falconledger@beartec.uk or the feedback page at falcon-fpl.com/feedback."
      }
    ]
  }
]

export default function TermsPage() {
  return (
    <ContentPage current="community" title="Testnet Allocation Programme: Terms and Conditions">
      {INTRO.map((t) => (
        <p key={t} className="text-slate-400">
          {t}
        </p>
      ))}
      {SECTIONS.map(({ title, blocks }) => (
        <Section key={title} title={title}>
          {blocks.map((b, i) =>
            'p' in b ? (
              <p key={i}>{b.p}</p>
            ) : (
              <ul key={i} className="list-disc pl-5 space-y-1">
                {b.list.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            ),
          )}
        </Section>
      ))}
    </ContentPage>
  )
}
